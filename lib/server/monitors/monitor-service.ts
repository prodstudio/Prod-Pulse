import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit/audit-log";
import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import {
  requireResourceAccess,
  type ActiveOrganizationContext,
} from "@/lib/server/auth/organization-context";
import {
  sanitizeMonitorForAudit,
  toSafeMonitorDetail,
  toSafeMonitorSummary,
  type RawMonitorRecord,
  type SafeMonitorSummary,
} from "@/lib/server/monitors/monitor-sanitization";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

const monitorStatusSchema = z.enum([
  "operational",
  "degraded",
  "down",
  "paused",
  "maintenance",
  "unknown",
]);

export const monitorTypeSchema = z.enum([
  "http",
  "api_health",
  "json_assertion",
  "latency_threshold",
  "ssl_expiry",
  "heartbeat",
]);

const requestMethodSchema = z.enum([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

export const createMonitorSchema = z
  .object({
    appId: z.uuid(),
    environmentId: z.uuid().optional().nullable(),
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9-]+$/, "Slug must contain lowercase letters, numbers, and hyphens."),
    type: monitorTypeSchema,
    description: z.string().trim().max(1000).optional().nullable(),
    status: monitorStatusSchema.optional(),
    isEnabled: z.boolean().optional(),
    requestMethod: requestMethodSchema.optional(),
    targetUrl: z.url().optional().nullable(),
    expectedStatusCodes: z.array(z.int().min(100).max(599)).max(10).optional(),
    timeoutMs: z.int().min(1000).max(60000).optional(),
    intervalSeconds: z.int().min(30).max(86400).optional(),
    latencyThresholdMs: z.int().min(1).max(60000).optional().nullable(),
    consecutiveFailureThreshold: z.int().min(1).max(20).optional(),
    consecutiveRecoveryThreshold: z.int().min(1).max(20).optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type !== "heartbeat" && !value.targetUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["targetUrl"],
        message: "targetUrl is required for this monitor type.",
      });
    }

    if (value.type === "latency_threshold" && !value.latencyThresholdMs) {
      ctx.addIssue({
        code: "custom",
        path: ["latencyThresholdMs"],
        message: "latencyThresholdMs is required for latency threshold monitors.",
      });
    }
  });

export const updateMonitorSchema = z
  .object({
    appId: z.uuid().optional(),
    environmentId: z.uuid().optional().nullable(),
    name: z.string().trim().min(1).max(120).optional(),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9-]+$/, "Slug must contain lowercase letters, numbers, and hyphens.")
      .optional(),
    type: monitorTypeSchema.optional(),
    description: z.string().trim().max(1000).optional().nullable(),
    status: monitorStatusSchema.optional(),
    isEnabled: z.boolean().optional(),
    requestMethod: requestMethodSchema.optional(),
    targetUrl: z.url().optional().nullable(),
    expectedStatusCodes: z.array(z.int().min(100).max(599)).max(10).optional(),
    timeoutMs: z.int().min(1000).max(60000).optional(),
    intervalSeconds: z.int().min(30).max(86400).optional(),
    latencyThresholdMs: z.int().min(1).max(60000).optional().nullable(),
    consecutiveFailureThreshold: z.int().min(1).max(20).optional(),
    consecutiveRecoveryThreshold: z.int().min(1).max(20).optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;

type ServiceContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

const MONITOR_TYPE_TO_DB = {
  http: "http_uptime",
  api_health: "api_health_endpoint",
  json_assertion: "json_assertion",
  latency_threshold: "latency_threshold",
  ssl_expiry: "ssl_expiry",
  heartbeat: "heartbeat_freshness",
} as const;

const DB_MONITOR_TYPE_TO_PUBLIC = {
  http_uptime: "http",
  api_health_endpoint: "api_health",
  json_assertion: "json_assertion",
  latency_threshold: "latency_threshold",
  ssl_expiry: "ssl_expiry",
  heartbeat_freshness: "heartbeat",
} as const;

function mapRawMonitorRow(row: Record<string, unknown>): RawMonitorRecord {
  const typeKey = String(row.type) as keyof typeof DB_MONITOR_TYPE_TO_PUBLIC;

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    appId: String(row.app_id),
    environmentId: (row.environment_id as string | null) ?? null,
    name: String(row.name),
    slug: String(row.slug),
    type: DB_MONITOR_TYPE_TO_PUBLIC[typeKey],
    status: String(row.status),
    isEnabled: Boolean(row.is_enabled),
    requestMethod: (row.request_method as string | null) ?? null,
    targetUrl: (row.target_url as string | null) ?? null,
    expectedStatusCodes: ((row.expected_status_codes as number[] | null) ?? []).map(Number),
    intervalSeconds: Number(row.interval_seconds),
    nextCheckAt: (row.next_check_at as string | null) ?? null,
    timeoutMs: Number(row.timeout_ms),
    latencyThresholdMs: (row.latency_threshold_ms as number | null) ?? null,
    consecutiveFailureThreshold: Number(row.consecutive_failure_threshold),
    consecutiveRecoveryThreshold: Number(row.consecutive_recovery_threshold),
    configuration: (row.configuration as Record<string, unknown> | null) ?? {},
    description: (row.description as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listMonitorsForOrganization(
  organizationId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeMonitorSummary[]> {
  const { data, error } = await adminClient
    .from("monitors")
    .select(
      "id, organization_id, app_id, environment_id, name, slug, type, status, is_enabled, request_method, target_url, expected_status_codes, interval_seconds, next_check_at, timeout_ms, latency_threshold_ms, consecutive_failure_threshold, consecutive_recovery_threshold, configuration, description, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) {
    throw mapPostgresError(error);
  }

  return (data ?? []).map((row) =>
    toSafeMonitorSummary(mapRawMonitorRow(row as Record<string, unknown>)),
  );
}

async function getRawMonitorById(
  userId: string,
  monitorId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<RawMonitorRecord> {
  const { resource } = await requireResourceAccess(
    userId,
    "monitor",
    monitorId,
    organizationId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("monitors")
    .select(
      "id, organization_id, app_id, environment_id, name, slug, type, status, is_enabled, request_method, target_url, expected_status_codes, interval_seconds, next_check_at, timeout_ms, latency_threshold_ms, consecutive_failure_threshold, consecutive_recovery_threshold, configuration, description, created_at, updated_at",
    )
    .eq("id", resource.id)
    .eq("organization_id", resource.organization_id)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "MONITOR_NOT_FOUND", "The requested monitor was not found.");
  }

  return mapRawMonitorRow(data as Record<string, unknown>);
}

export async function getMonitorById(
  userId: string,
  monitorId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const rawMonitor = await getRawMonitorById(
    userId,
    monitorId,
    organizationId,
    adminClient,
  );

  return toSafeMonitorDetail(rawMonitor);
}

async function assertAppAndEnvironmentAccess(
  userId: string,
  organizationId: string,
  appId: string,
  environmentId: string | null | undefined,
  adminClient: AdminLike,
) {
  await requireResourceAccess(userId, "app", appId, organizationId, adminClient);

  if (!environmentId) {
    return;
  }

  const { resource } = await requireResourceAccess(
    userId,
    "environment",
    environmentId,
    organizationId,
    adminClient,
  );

  if (resource.app_id !== appId) {
    throw new ApiError(
      400,
      "ENVIRONMENT_APP_MISMATCH",
      "The selected environment does not belong to the selected app.",
    );
  }
}

export async function createMonitor(
  context: ServiceContext,
  input: CreateMonitorInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  await assertAppAndEnvironmentAccess(
    context.userId,
    context.organization.id,
    input.appId,
    input.environmentId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("monitors")
    .insert({
      organization_id: context.organization.id,
      app_id: input.appId,
      environment_id: input.environmentId ?? null,
      name: input.name,
      slug: input.slug,
      type: MONITOR_TYPE_TO_DB[input.type],
      status: input.status ?? "unknown",
      is_enabled: input.isEnabled ?? true,
      description: input.description ?? null,
      request_method: input.requestMethod ?? "GET",
      target_url: input.targetUrl ?? null,
      expected_status_codes: input.expectedStatusCodes ?? [200],
      timeout_ms: input.timeoutMs ?? 10000,
      interval_seconds: input.intervalSeconds ?? 300,
      latency_threshold_ms: input.latencyThresholdMs ?? null,
      consecutive_failure_threshold: input.consecutiveFailureThreshold ?? 3,
      consecutive_recovery_threshold: input.consecutiveRecoveryThreshold ?? 2,
      configuration: input.configuration ?? {},
      next_check_at: new Date().toISOString(),
      created_by: context.userId,
    })
    .select(
      "id, organization_id, app_id, environment_id, name, slug, type, status, is_enabled, request_method, target_url, expected_status_codes, interval_seconds, next_check_at, timeout_ms, latency_threshold_ms, consecutive_failure_threshold, consecutive_recovery_threshold, configuration, description, created_at, updated_at",
    )
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const rawMonitor = mapRawMonitorRow(data as Record<string, unknown>);
  const monitor = toSafeMonitorSummary(rawMonitor);

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "monitors",
    targetId: monitor.id,
    metadata: {
      created: sanitizeMonitorForAudit(rawMonitor),
    },
    request: context.request,
  });

  return monitor;
}

export async function updateMonitor(
  context: ServiceContext,
  monitorId: string,
  input: UpdateMonitorInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const existing = await getRawMonitorById(
    context.userId,
    monitorId,
    context.organization.id,
    adminClient,
  );

  const nextAppId = input.appId ?? existing.appId;
  const nextEnvironmentId =
    input.environmentId === undefined ? existing.environmentId : (input.environmentId ?? null);

  await assertAppAndEnvironmentAccess(
    context.userId,
    context.organization.id,
    nextAppId,
    nextEnvironmentId,
    adminClient,
  );

  const nextType = input.type ?? existing.type;
  const mergedPayload = {
    appId: nextAppId,
    environmentId: nextEnvironmentId,
    name: input.name ?? existing.name,
    slug: input.slug ?? existing.slug,
    type: nextType,
    description:
      input.description === undefined ? existing.description : (input.description ?? null),
    status: input.status ?? existing.status,
    isEnabled: input.isEnabled ?? existing.isEnabled,
    requestMethod: input.requestMethod ?? existing.requestMethod ?? "GET",
    targetUrl: input.targetUrl === undefined ? existing.targetUrl : (input.targetUrl ?? null),
    expectedStatusCodes: input.expectedStatusCodes ?? existing.expectedStatusCodes,
    timeoutMs: input.timeoutMs ?? existing.timeoutMs,
    intervalSeconds: input.intervalSeconds ?? existing.intervalSeconds,
    latencyThresholdMs:
      input.latencyThresholdMs === undefined
        ? existing.latencyThresholdMs
        : (input.latencyThresholdMs ?? null),
    consecutiveFailureThreshold:
      input.consecutiveFailureThreshold ?? existing.consecutiveFailureThreshold,
    consecutiveRecoveryThreshold:
      input.consecutiveRecoveryThreshold ?? existing.consecutiveRecoveryThreshold,
    configuration: input.configuration ?? existing.configuration,
  };

  const mergedValidation = createMonitorSchema.safeParse(mergedPayload);

  if (!mergedValidation.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed.", {
      issues: mergedValidation.error.flatten(),
    });
  }

  const payload = {
    app_id: mergedPayload.appId,
    environment_id: mergedPayload.environmentId,
    name: mergedPayload.name,
    slug: mergedPayload.slug,
    type: MONITOR_TYPE_TO_DB[nextType],
    status: mergedPayload.status,
    is_enabled: mergedPayload.isEnabled,
    description: mergedPayload.description,
    request_method: mergedPayload.requestMethod,
    target_url: mergedPayload.targetUrl,
    expected_status_codes: mergedPayload.expectedStatusCodes,
    timeout_ms: mergedPayload.timeoutMs,
    interval_seconds: mergedPayload.intervalSeconds,
    latency_threshold_ms: mergedPayload.latencyThresholdMs,
    consecutive_failure_threshold: mergedPayload.consecutiveFailureThreshold,
    consecutive_recovery_threshold: mergedPayload.consecutiveRecoveryThreshold,
    configuration: mergedPayload.configuration,
  };

  const { data, error } = await adminClient
    .from("monitors")
    .update(payload)
    .eq("id", monitorId)
    .eq("organization_id", context.organization.id)
    .select(
      "id, organization_id, app_id, environment_id, name, slug, type, status, is_enabled, request_method, target_url, expected_status_codes, interval_seconds, next_check_at, timeout_ms, latency_threshold_ms, consecutive_failure_threshold, consecutive_recovery_threshold, configuration, description, created_at, updated_at",
    )
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const rawMonitor = mapRawMonitorRow(data as Record<string, unknown>);
  const monitor = toSafeMonitorSummary(rawMonitor);

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "monitors",
    targetId: monitor.id,
    metadata: {
      before: sanitizeMonitorForAudit(existing),
      after: sanitizeMonitorForAudit(rawMonitor),
    },
    request: context.request,
  });

  return monitor;
}

export async function deleteMonitor(
  context: ServiceContext,
  monitorId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const monitor = await getRawMonitorById(
    context.userId,
    monitorId,
    context.organization.id,
    adminClient,
  );

  const { error } = await adminClient
    .from("monitors")
    .delete()
    .eq("id", monitorId)
    .eq("organization_id", context.organization.id);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "delete",
    targetTable: "monitors",
    targetId: monitorId,
    metadata: {
      deleted: sanitizeMonitorForAudit(monitor),
    },
    request: context.request,
  });

  return { success: true };
}
