import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";
import {
  sanitizeExternalIssueCustomerReference,
  sanitizeExternalIssueForAudit,
  sanitizeExternalIssueIdentifier,
  sanitizeExternalIssueKey,
  sanitizeExternalIssuePriority,
  sanitizeExternalIssueStatus,
  sanitizeExternalIssueSummary,
  sanitizeExternalIssueTitle,
  sanitizeExternalIssueUrl,
  toSafeExternalIssue,
  type RawExternalIssueRecord,
  type SafeExternalIssue,
} from "@/lib/server/external-issues/external-issue-sanitization";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type IntegrationRow = {
  id: string;
  organization_id: string;
  kind: string;
  name: string;
  is_enabled: boolean;
  inbound_key_hash: string | null;
};

type ResourceLookup = {
  id: string;
  organization_id: string;
  app_id?: string | null;
  environment_id?: string | null;
};

type ExternalIssueLookupRow = Record<string, unknown>;

const EXTERNAL_ISSUE_SELECT = [
  "id",
  "organization_id",
  "integration_id",
  "source_kind",
  "external_id",
  "external_key",
  "title",
  "status",
  "priority",
  "source_url",
  "customer_reference",
  "summary",
  "created_by",
  "first_seen_at",
  "last_synced_at",
  "source_created_at",
  "source_updated_at",
  "related_app_id",
  "related_environment_id",
  "related_monitor_id",
  "created_at",
  "updated_at",
].join(", ");

export const ciexInboundTicketSchema = z.object({
  externalId: z.string().trim().min(1).max(160),
  externalKey: z.string().trim().max(160).optional().nullable(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).optional().nullable(),
  status: z.string().trim().max(80).optional().nullable(),
  priority: z.string().trim().max(80).optional().nullable(),
  sourceUrl: z.string().trim().max(500).optional().nullable(),
  customerReference: z.string().trim().max(160).optional().nullable(),
  appId: z.string().uuid().optional().nullable(),
  environmentId: z.string().uuid().optional().nullable(),
  monitorId: z.string().uuid().optional().nullable(),
  sourceCreatedAt: z.string().datetime({ offset: true }).optional().nullable(),
  sourceUpdatedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

export const ciexInboundPayloadSchema = z.object({
  ticket: ciexInboundTicketSchema,
  eventType: z.string().trim().max(80).optional().nullable(),
  deliveredAt: z.string().datetime({ offset: true }).optional().nullable(),
});

export type CiexInboundPayload = z.infer<typeof ciexInboundPayloadSchema>;

export type CiexInboundResult = {
  issue: SafeExternalIssue;
  suggestedIncidentIds: string[];
  created: boolean;
  updated: boolean;
};

function toExternalIssueLookupRow(row: unknown): ExternalIssueLookupRow {
  return row as ExternalIssueLookupRow;
}

function hashInboundKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function getInboundKey(request: Request) {
  const direct = request.headers.get("x-prod-pulse-integration-key")?.trim();

  if (direct) {
    return direct;
  }

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() ?? null;
}

function mapExternalIssueRow(row: ExternalIssueLookupRow): RawExternalIssueRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    integrationId: (row.integration_id as string | null) ?? null,
    sourceKind: String(row.source_kind),
    externalId: String(row.external_id),
    externalKey: (row.external_key as string | null) ?? null,
    title: String(row.title),
    status: (row.status as string | null) ?? null,
    priority: (row.priority as string | null) ?? null,
    sourceUrl: (row.source_url as string | null) ?? null,
    customerReference: (row.customer_reference as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    firstSeenAt: (row.first_seen_at as string | null) ?? null,
    lastSyncedAt: (row.last_synced_at as string | null) ?? null,
    sourceCreatedAt: (row.source_created_at as string | null) ?? null,
    sourceUpdatedAt: (row.source_updated_at as string | null) ?? null,
    relatedAppId: (row.related_app_id as string | null) ?? null,
    relatedEnvironmentId: (row.related_environment_id as string | null) ?? null,
    relatedMonitorId: (row.related_monitor_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    linkedAt: (row.linked_at as string | null) ?? null,
  };
}

async function resolveCiexIntegration(request: Request, adminClient: AdminLike) {
  const inboundKey = getInboundKey(request);

  if (!inboundKey) {
    throw new ApiError(401, "unauthorized", "Authentication required.");
  }

  const { data, error } = await adminClient
    .from("integrations")
    .select("id, organization_id, kind, name, is_enabled, inbound_key_hash")
    .eq("kind", "ciex")
    .eq("inbound_key_hash", hashInboundKey(inboundKey))
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  const integration = data as IntegrationRow | null;

  if (!integration || !integration.is_enabled) {
    throw new ApiError(401, "unauthorized", "Authentication required.");
  }

  return integration;
}

async function loadScopedResource(
  table: "monitored_apps" | "app_environments" | "monitors",
  organizationId: string,
  resourceId: string,
  adminClient: AdminLike,
) {
  const { data, error } = await adminClient
    .from(table)
    .select("id, organization_id, app_id, environment_id")
    .eq("organization_id", organizationId)
    .eq("id", resourceId)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
  }

  return data as ResourceLookup;
}

async function resolveRelatedRefs(
  organizationId: string,
  input: z.infer<typeof ciexInboundTicketSchema>,
  adminClient: AdminLike,
) {
  let appId = input.appId ?? null;
  let environmentId = input.environmentId ?? null;
  const monitorId = input.monitorId ?? null;

  let environment: ResourceLookup | null = null;
  let monitor: ResourceLookup | null = null;

  if (appId) {
    await loadScopedResource("monitored_apps", organizationId, appId, adminClient);
  }

  if (environmentId) {
    environment = await loadScopedResource("app_environments", organizationId, environmentId, adminClient);

    if (appId && environment.app_id !== appId) {
      throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
    }

    appId ??= environment.app_id ?? null;
  }

  if (monitorId) {
    monitor = await loadScopedResource("monitors", organizationId, monitorId, adminClient);

    if (appId && monitor.app_id !== appId) {
      throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
    }

    if (environmentId && (monitor.environment_id ?? null) !== environmentId) {
      throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
    }

    appId ??= monitor.app_id ?? null;
    environmentId ??= monitor.environment_id ?? null;
  }

  return {
    relatedAppId: appId,
    relatedEnvironmentId: environmentId,
    relatedMonitorId: monitorId,
  };
}

function sanitizeInboundTicket(input: z.infer<typeof ciexInboundTicketSchema>) {
  const externalId = sanitizeExternalIssueIdentifier(input.externalId);

  if (!externalId) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed.", {
      issues: {
        fieldErrors: {
          externalId: ["External issue id is required."],
        },
        formErrors: [],
      },
    });
  }

  return {
    sourceKind: "ciex",
    externalId,
    externalKey: sanitizeExternalIssueKey(input.externalKey),
    title: sanitizeExternalIssueTitle(input.title),
    summary: sanitizeExternalIssueSummary(input.summary),
    status: sanitizeExternalIssueStatus(input.status),
    priority: sanitizeExternalIssuePriority(input.priority),
    sourceUrl: sanitizeExternalIssueUrl(input.sourceUrl),
    customerReference: sanitizeExternalIssueCustomerReference(input.customerReference),
    sourceCreatedAt: input.sourceCreatedAt ?? null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  };
}

async function listSuggestedIncidentIdsForIssue(
  issue: RawExternalIssueRecord,
  adminClient: AdminLike,
) {
  if (!issue.relatedAppId) {
    return [];
  }

  const { data, error } = await adminClient
    .from("incidents")
    .select("id, app_id, environment_id, monitor_id, status")
    .eq("organization_id", issue.organizationId)
    .eq("app_id", issue.relatedAppId)
    .neq("status", "resolved")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    throw mapPostgresError(error);
  }

  const incidentIds = (data ?? [])
    .filter((row) => {
      const incident = row as Record<string, unknown>;
      const incidentMonitorId = (incident.monitor_id as string | null) ?? null;
      const incidentEnvironmentId = (incident.environment_id as string | null) ?? null;

      if (issue.relatedMonitorId) {
        return incidentMonitorId === issue.relatedMonitorId;
      }

      if (issue.relatedEnvironmentId) {
        return incidentEnvironmentId === issue.relatedEnvironmentId;
      }

      return true;
    })
    .map((row) => String((row as Record<string, unknown>).id));

  if (incidentIds.length === 0) {
    return [];
  }

  const { data: linkedRows, error: linkedError } = await adminClient
    .from("incident_external_issues")
    .select("incident_id")
    .eq("organization_id", issue.organizationId)
    .eq("external_issue_id", issue.id)
    .in("incident_id", incidentIds);

  if (linkedError) {
    throw mapPostgresError(linkedError);
  }

  const linkedIds = new Set((linkedRows ?? []).map((row) => String((row as Record<string, unknown>).incident_id)));

  return incidentIds.filter((incidentId) => !linkedIds.has(incidentId));
}

export async function ingestCiexInboundIssue(
  request: Request,
  payload: CiexInboundPayload,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<CiexInboundResult> {
  const integration = await resolveCiexIntegration(request, adminClient);
  const sanitized = sanitizeInboundTicket(payload.ticket);
  const related = await resolveRelatedRefs(integration.organization_id, payload.ticket, adminClient);
  const now = new Date().toISOString();

  const { data: existing, error: lookupError } = await adminClient
    .from("external_issues")
    .select(EXTERNAL_ISSUE_SELECT)
    .eq("organization_id", integration.organization_id)
    .eq("integration_id", integration.id)
    .eq("external_id", sanitized.externalId)
    .maybeSingle();

  if (lookupError) {
    throw mapPostgresError(lookupError);
  }

  const existingRow = existing ? toExternalIssueLookupRow(existing) : null;

  let raw: RawExternalIssueRecord;
  let created = false;
  let updated = false;

  if (existingRow) {
    updated = true;

    const { data, error } = await adminClient
      .from("external_issues")
      .update({
        external_key: sanitized.externalKey,
        title: sanitized.title,
        summary: sanitized.summary,
        status: sanitized.status,
        priority: sanitized.priority,
        source_url: sanitized.sourceUrl,
        customer_reference: sanitized.customerReference,
        source_created_at: sanitized.sourceCreatedAt,
        source_updated_at: sanitized.sourceUpdatedAt,
        related_app_id: related.relatedAppId,
        related_environment_id: related.relatedEnvironmentId,
        related_monitor_id: related.relatedMonitorId,
        last_synced_at: now,
      })
      .eq("id", String(existingRow.id))
      .eq("organization_id", integration.organization_id)
      .select(EXTERNAL_ISSUE_SELECT)
      .single();

    if (error) {
      throw mapPostgresError(error);
    }

    raw = mapExternalIssueRow(toExternalIssueLookupRow(data));
  } else {
    created = true;

    const { data, error } = await adminClient
      .from("external_issues")
      .insert({
        organization_id: integration.organization_id,
        integration_id: integration.id,
        source_kind: "ciex",
        external_id: sanitized.externalId,
        external_key: sanitized.externalKey,
        title: sanitized.title,
        summary: sanitized.summary,
        status: sanitized.status,
        priority: sanitized.priority,
        source_url: sanitized.sourceUrl,
        customer_reference: sanitized.customerReference,
        source_created_at: sanitized.sourceCreatedAt,
        source_updated_at: sanitized.sourceUpdatedAt,
        related_app_id: related.relatedAppId,
        related_environment_id: related.relatedEnvironmentId,
        related_monitor_id: related.relatedMonitorId,
        first_seen_at: now,
        last_synced_at: now,
      })
      .select(EXTERNAL_ISSUE_SELECT)
      .single();

    if (error) {
      throw mapPostgresError(error);
    }

    raw = mapExternalIssueRow(toExternalIssueLookupRow(data));
  }

  const { error: integrationError } = await adminClient
    .from("integrations")
    .update({ last_inbound_at: now })
    .eq("id", integration.id)
    .eq("organization_id", integration.organization_id);

  if (integrationError) {
    throw mapPostgresError(integrationError);
  }

  const suggestedIncidentIds = await listSuggestedIncidentIdsForIssue(raw, adminClient);

  await writeAuditLog({
    organizationId: integration.organization_id,
    actorType: "system",
    actionType: "system",
    targetTable: "external_issues",
    targetId: raw.id,
    metadata: {
      sourceKind: "ciex",
      integrationId: integration.id,
      integrationName: integration.name,
      eventType: payload.eventType ?? null,
      action: created ? "ingest_create" : "ingest_update",
      issue: sanitizeExternalIssueForAudit(raw),
      suggestedIncidentIds,
    },
    request,
  });

  return {
    issue: toSafeExternalIssue(raw),
    suggestedIncidentIds,
    created,
    updated,
  };
}
