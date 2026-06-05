import "server-only";

import { z } from "zod";

import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import type { ActiveOrganizationContext } from "@/lib/server/auth/organization-context";
import {
  requireOrgMembership,
  requireResourceAccess,
} from "@/lib/server/auth/organization-context";
import {
  ALERT_EVENT_TYPES,
  sanitizeAlertRuleForAudit,
  toSafeAlertRule,
  type AlertEventType,
  type SafeAlertRule,
} from "@/lib/server/alerts/alert-sanitization";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type AlertRuleServiceContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

type RawAlertRuleRecord = {
  id: string;
  organizationId: string;
  appId: string | null;
  monitorId: string | null;
  name: string;
  isEnabled: boolean;
  severityFilter: Array<"info" | "warning" | "critical" | "emergency">;
  sendRecovery: boolean;
  notifyOnDegraded: boolean;
  dedupeWindowSeconds: number;
  maxRetryAttempts: number;
  backoffStrategy: string;
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const RULE_SELECT = [
  "id",
  "organization_id",
  "app_id",
  "monitor_id",
  "name",
  "is_enabled",
  "severity_filter",
  "send_recovery",
  "notify_on_degraded",
  "dedupe_window_seconds",
  "max_retry_attempts",
  "backoff_strategy",
  "configuration",
  "created_at",
  "updated_at",
].join(", ");

const eventTypeSchema = z.enum(ALERT_EVENT_TYPES);
const severitySchema = z.enum(["info", "warning", "critical", "emergency"]);

export const createAlertRuleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  appId: z.string().uuid().optional().nullable(),
  monitorId: z.string().uuid().optional().nullable(),
  isEnabled: z.boolean().optional().default(true),
  severityFilter: z.array(severitySchema).optional().default([]),
  sendRecovery: z.boolean().optional().default(true),
  notifyOnDegraded: z.boolean().optional().default(true),
  dedupeWindowSeconds: z.number().int().min(0).max(86_400).optional().default(1800),
  maxRetryAttempts: z.number().int().min(0).max(10).optional().default(5),
  backoffStrategy: z.literal("exponential").optional().default("exponential"),
  eventTypes: z.array(eventTypeSchema).min(1),
  notificationChannelIds: z.array(z.string().uuid()).min(1),
});

export const updateAlertRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    appId: z.string().uuid().optional().nullable(),
    monitorId: z.string().uuid().optional().nullable(),
    isEnabled: z.boolean().optional(),
    severityFilter: z.array(severitySchema).optional(),
    sendRecovery: z.boolean().optional(),
    notifyOnDegraded: z.boolean().optional(),
    dedupeWindowSeconds: z.number().int().min(0).max(86_400).optional(),
    maxRetryAttempts: z.number().int().min(0).max(10).optional(),
    backoffStrategy: z.literal("exponential").optional(),
    eventTypes: z.array(eventTypeSchema).min(1).optional(),
    notificationChannelIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

function mapRuleRow(row: Record<string, unknown>): RawAlertRuleRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    appId: (row.app_id as string | null) ?? null,
    monitorId: (row.monitor_id as string | null) ?? null,
    name: String(row.name),
    isEnabled: Boolean(row.is_enabled),
    severityFilter:
      ((row.severity_filter as RawAlertRuleRecord["severityFilter"] | null) ?? []).filter(Boolean),
    sendRecovery: Boolean(row.send_recovery),
    notifyOnDegraded: Boolean(row.notify_on_degraded),
    dedupeWindowSeconds: Number(row.dedupe_window_seconds),
    maxRetryAttempts: Number(row.max_retry_attempts),
    backoffStrategy: String(row.backoff_strategy),
    configuration: ((row.configuration as Record<string, unknown> | null) ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function ensureScopedResources(
  userId: string,
  organizationId: string,
  input: { appId?: string | null; monitorId?: string | null },
  adminClient: AdminLike,
) {
  if (input.appId) {
    await requireResourceAccess(userId, "app", input.appId, organizationId, adminClient);
  }

  if (input.monitorId) {
    const { resource } = await requireResourceAccess(
      userId,
      "monitor",
      input.monitorId,
      organizationId,
      adminClient,
    );

    if (input.appId && resource.app_id !== input.appId) {
      throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
    }
  }
}

async function ensureChannelTargetsExist(
  organizationId: string,
  notificationChannelIds: string[],
  adminClient: AdminLike,
) {
  const uniqueIds = Array.from(new Set(notificationChannelIds));
  const { data, error } = await adminClient
    .from("notification_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", uniqueIds);

  if (error) {
    throw mapPostgresError(error);
  }

  if ((data ?? []).length !== uniqueIds.length) {
    throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
  }
}

async function getRawAlertRuleById(
  userId: string,
  ruleId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { resource } = await requireResourceAccess(
    userId,
    "alert_rule",
    ruleId,
    organizationId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("alert_rules")
    .select(RULE_SELECT)
    .eq("id", resource.id)
    .eq("organization_id", resource.organization_id)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  return mapRuleRow(data as unknown as Record<string, unknown>);
}

function buildRuleConfiguration(input: {
  eventTypes: AlertEventType[];
  notificationChannelIds: string[];
}) {
  return {
    eventTypes: Array.from(new Set(input.eventTypes)),
    notificationChannelIds: Array.from(new Set(input.notificationChannelIds)),
  };
}

function toPostgresSeverityFilterLiteral(
  values: Array<"info" | "warning" | "critical" | "emergency">,
) {
  if (values.length === 0) {
    return null;
  }

  return `{${values.join(",")}}`;
}

export async function listAlertRulesForOrganization(
  userId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeAlertRule[]> {
  const organizationContext = await requireOrgMembership(userId, organizationId, adminClient);

  const { data, error } = await adminClient
    .from("alert_rules")
    .select(RULE_SELECT)
    .eq("organization_id", organizationContext.organization.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw mapPostgresError(error);
  }

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) =>
    toSafeAlertRule(mapRuleRow(row)),
  );
}

export async function getAlertRuleById(
  userId: string,
  ruleId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  return toSafeAlertRule(await getRawAlertRuleById(userId, ruleId, organizationId, adminClient));
}

export async function createAlertRule(
  context: AlertRuleServiceContext,
  input: z.infer<typeof createAlertRuleSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  await ensureScopedResources(
    context.userId,
    context.organization.id,
    {
      appId: input.appId ?? null,
      monitorId: input.monitorId ?? null,
    },
    adminClient,
  );
  await ensureChannelTargetsExist(
    context.organization.id,
    input.notificationChannelIds,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("alert_rules")
    .insert({
      organization_id: context.organization.id,
      app_id: input.appId ?? null,
      monitor_id: input.monitorId ?? null,
      name: input.name,
      is_enabled: input.isEnabled,
      severity_filter: toPostgresSeverityFilterLiteral(input.severityFilter),
      send_recovery: input.sendRecovery,
      notify_on_degraded: input.notifyOnDegraded,
      dedupe_window_seconds: input.dedupeWindowSeconds,
      max_retry_attempts: input.maxRetryAttempts,
      backoff_strategy: input.backoffStrategy,
      configuration: buildRuleConfiguration(input),
      created_by: context.userId,
    })
    .select(RULE_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const rule = mapRuleRow(data as unknown as Record<string, unknown>);

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "alert_rules",
    targetId: rule.id,
    metadata: {
      rule: sanitizeAlertRuleForAudit(rule),
    },
    request: context.request,
  });

  return toSafeAlertRule(rule);
}

export async function updateAlertRule(
  context: AlertRuleServiceContext,
  ruleId: string,
  input: z.infer<typeof updateAlertRuleSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const before = await getRawAlertRuleById(
    context.userId,
    ruleId,
    context.organization.id,
    adminClient,
  );

  await ensureScopedResources(
    context.userId,
    context.organization.id,
    {
      appId: input.appId === undefined ? before.appId : (input.appId ?? null),
      monitorId:
        input.monitorId === undefined ? before.monitorId : (input.monitorId ?? null),
    },
    adminClient,
  );

  const nextConfiguration = buildRuleConfiguration({
    eventTypes:
      input.eventTypes ??
      ((before.configuration.eventTypes as AlertEventType[] | undefined) ?? []),
    notificationChannelIds:
      input.notificationChannelIds ??
      ((before.configuration.notificationChannelIds as string[] | undefined) ?? []),
  });

  await ensureChannelTargetsExist(
    context.organization.id,
    nextConfiguration.notificationChannelIds,
    adminClient,
  );

  const patch: Record<string, unknown> = {
    configuration: nextConfiguration,
  };

  if (input.name !== undefined) {
    patch.name = input.name;
  }
  if (input.appId !== undefined) {
    patch.app_id = input.appId ?? null;
  }
  if (input.monitorId !== undefined) {
    patch.monitor_id = input.monitorId ?? null;
  }
  if (input.isEnabled !== undefined) {
    patch.is_enabled = input.isEnabled;
  }
  if (input.severityFilter !== undefined) {
    patch.severity_filter = toPostgresSeverityFilterLiteral(input.severityFilter);
  }
  if (input.sendRecovery !== undefined) {
    patch.send_recovery = input.sendRecovery;
  }
  if (input.notifyOnDegraded !== undefined) {
    patch.notify_on_degraded = input.notifyOnDegraded;
  }
  if (input.dedupeWindowSeconds !== undefined) {
    patch.dedupe_window_seconds = input.dedupeWindowSeconds;
  }
  if (input.maxRetryAttempts !== undefined) {
    patch.max_retry_attempts = input.maxRetryAttempts;
  }
  if (input.backoffStrategy !== undefined) {
    patch.backoff_strategy = input.backoffStrategy;
  }

  const { data, error } = await adminClient
    .from("alert_rules")
    .update(patch)
    .eq("id", before.id)
    .eq("organization_id", before.organizationId)
    .select(RULE_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const after = mapRuleRow(data as unknown as Record<string, unknown>);

  await writeAuditLog({
    organizationId: before.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "alert_rules",
    targetId: before.id,
    metadata: {
      before: sanitizeAlertRuleForAudit(before),
      after: sanitizeAlertRuleForAudit(after),
    },
    request: context.request,
  });

  return toSafeAlertRule(after);
}

export async function deleteAlertRule(
  context: AlertRuleServiceContext,
  ruleId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const rule = await getRawAlertRuleById(
    context.userId,
    ruleId,
    context.organization.id,
    adminClient,
  );

  const { error } = await adminClient
    .from("alert_rules")
    .delete()
    .eq("id", rule.id)
    .eq("organization_id", rule.organizationId);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: rule.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "delete",
    targetTable: "alert_rules",
    targetId: rule.id,
    metadata: {
      deleted: sanitizeAlertRuleForAudit(rule),
    },
    request: context.request,
  });
}
