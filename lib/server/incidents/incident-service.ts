import "server-only";

import { z } from "zod";

import { mapPostgresError, ApiError } from "@/lib/server/api/errors";
import { queueIncidentAlertDeliveries } from "@/lib/server/alerts/alert-engine";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import {
  requireOrgMembership,
  requireResourceAccess,
  type ActiveOrganizationContext,
} from "@/lib/server/auth/organization-context";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";
import {
  sanitizeIncidentForAudit,
  sanitizeIncidentText,
  toSafeIncidentDetail,
  toSafeIncidentSummary,
  toSafeIncidentUpdate,
  withLinkedExternalIssues,
  type IncidentRelations,
  type RawIncidentRecord,
  type SafeIncidentDetail,
  type SafeIncidentSummary,
} from "@/lib/server/incidents/incident-sanitization";
import { listLinkedExternalIssuesForIncident } from "@/lib/server/external-issues/external-issue-service";
import { toSafeMonitorResult, type SafeMonitorResult } from "@/lib/server/monitoring/result-sanitization";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type IncidentStatus =
  | "detected"
  | "open"
  | "acknowledged"
  | "investigating"
  | "monitoring"
  | "resolved";

type IncidentServiceContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

type IncidentListFilter = "active" | "resolved" | "all";

type RawIncidentUpdateRow = {
  id: string;
  actor_type: "user" | "system" | "heartbeat";
  actor_user_id: string | null;
  status_from: IncidentStatus | null;
  status_to: IncidentStatus | null;
  message: string | null;
  created_at: string;
};

type IncidentLookupRow = Record<string, unknown>;

type RelationRow = {
  id: string;
  name: string;
  slug?: string | null;
};

const INCIDENT_SELECT = [
  "id",
  "organization_id",
  "app_id",
  "environment_id",
  "monitor_id",
  "created_from_result_id",
  "title",
  "summary",
  "severity",
  "status",
  "dedupe_key",
  "assigned_to",
  "opened_by",
  "detected_at",
  "opened_at",
  "acknowledged_at",
  "recovered_at",
  "resolved_at",
  "auto_resolve_on_recovery",
  "root_cause",
  "resolution_notes",
  "customer_impact_summary",
  "customer_impact_notes",
  "last_state_change_at",
  "created_at",
  "updated_at",
].join(", ");

export const incidentFilterSchema = z.object({
  filter: z.enum(["active", "resolved", "all"]).optional(),
});

export const createIncidentUpdateSchema = z
  .object({
    message: z.string().trim().max(4000).optional().nullable(),
    statusTo: z.enum(["investigating", "monitoring"]).optional(),
    rootCause: z.string().trim().max(4000).optional().nullable(),
    resolutionNotes: z.string().trim().max(4000).optional().nullable(),
  })
  .refine(
    (value) =>
      Boolean(
        value.statusTo ||
          value.message ||
          value.rootCause ||
          value.resolutionNotes,
      ),
    "At least one incident update field must be provided.",
  );

export const resolveIncidentSchema = z.object({
  message: z.string().trim().max(4000).optional().nullable(),
  resolutionNotes: z.string().trim().max(4000).optional().nullable(),
  rootCause: z.string().trim().max(4000).optional().nullable(),
});

export type CreateIncidentUpdateInput = z.infer<typeof createIncidentUpdateSchema>;
export type ResolveIncidentInput = z.infer<typeof resolveIncidentSchema>;

function mapIncidentRow(row: IncidentLookupRow): RawIncidentRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    appId: String(row.app_id),
    environmentId: (row.environment_id as string | null) ?? null,
    monitorId: String(row.monitor_id),
    createdFromResultId: (row.created_from_result_id as string | null) ?? null,
    title: String(row.title),
    summary: (row.summary as string | null) ?? null,
    severity: String(row.severity) as RawIncidentRecord["severity"],
    status: String(row.status) as RawIncidentRecord["status"],
    dedupeKey: String(row.dedupe_key),
    assignedTo: (row.assigned_to as string | null) ?? null,
    openedBy: (row.opened_by as string | null) ?? null,
    detectedAt: String(row.detected_at),
    openedAt: (row.opened_at as string | null) ?? null,
    acknowledgedAt: (row.acknowledged_at as string | null) ?? null,
    recoveredAt: (row.recovered_at as string | null) ?? null,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    autoResolveOnRecovery: Boolean(row.auto_resolve_on_recovery),
    rootCause: (row.root_cause as string | null) ?? null,
    resolutionNotes: (row.resolution_notes as string | null) ?? null,
    customerImpactSummary: (row.customer_impact_summary as string | null) ?? null,
    customerImpactNotes: (row.customer_impact_notes as string | null) ?? null,
    lastStateChangeAt: String(row.last_state_change_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapResultRow(row: Record<string, unknown>): SafeMonitorResult {
  return toSafeMonitorResult({
    id: String(row.id),
    status: String(row.status),
    triggerSource: String(row.trigger_source),
    checkedAt: String(row.checked_at),
    durationMs: (row.duration_ms as number | null) ?? null,
    httpStatus: (row.http_status as number | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    responseExcerpt: (row.response_excerpt as string | null) ?? null,
    assertionResults: (row.assertion_results as Record<string, unknown> | null) ?? {},
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  });
}

async function loadIncidentRelations(
  organizationId: string,
  rows: RawIncidentRecord[],
  adminClient: AdminLike,
) {
  const appIds = Array.from(new Set(rows.map((row) => row.appId)));
  const environmentIds = Array.from(
    new Set(rows.map((row) => row.environmentId).filter((value): value is string => Boolean(value))),
  );
  const monitorIds = Array.from(new Set(rows.map((row) => row.monitorId)));

  const [appsResult, environmentsResult, monitorsResult] = await Promise.all([
    appIds.length
      ? adminClient
          .from("monitored_apps")
          .select("id, name, slug")
          .eq("organization_id", organizationId)
          .in("id", appIds)
      : Promise.resolve({ data: [], error: null }),
    environmentIds.length
      ? adminClient
          .from("app_environments")
          .select("id, name")
          .eq("organization_id", organizationId)
          .in("id", environmentIds)
      : Promise.resolve({ data: [], error: null }),
    monitorIds.length
      ? adminClient
          .from("monitors")
          .select("id, name, slug")
          .eq("organization_id", organizationId)
          .in("id", monitorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (appsResult.error) {
    throw mapPostgresError(appsResult.error);
  }
  if (environmentsResult.error) {
    throw mapPostgresError(environmentsResult.error);
  }
  if (monitorsResult.error) {
    throw mapPostgresError(monitorsResult.error);
  }

  const appMap = new Map(
    ((appsResult.data ?? []) as RelationRow[]).map((app) => [app.id, app]),
  );
  const environmentMap = new Map(
    ((environmentsResult.data ?? []) as RelationRow[]).map((environment) => [environment.id, environment]),
  );
  const monitorMap = new Map(
    ((monitorsResult.data ?? []) as RelationRow[]).map((monitor) => [monitor.id, monitor]),
  );

  return new Map<string, IncidentRelations>(
    rows.map((row) => [
      row.id,
      {
        appName: appMap.get(row.appId)?.name ?? null,
        appSlug: appMap.get(row.appId)?.slug ?? null,
        environmentName: row.environmentId ? environmentMap.get(row.environmentId)?.name ?? null : null,
        monitorName: monitorMap.get(row.monitorId)?.name ?? null,
        monitorSlug: monitorMap.get(row.monitorId)?.slug ?? null,
      },
    ]),
  );
}

async function getRawIncidentById(
  userId: string,
  incidentId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { resource, organizationContext } = await requireResourceAccess(
    userId,
    "incident",
    incidentId,
    organizationId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("incidents")
    .select(INCIDENT_SELECT)
    .eq("id", resource.id)
    .eq("organization_id", resource.organization_id)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "INCIDENT_NOT_FOUND", "The requested incident was not found.");
  }

  return {
    organizationContext,
    incident: mapIncidentRow(data as unknown as IncidentLookupRow),
  };
}

async function appendIncidentUpdate(
  incident: RawIncidentRecord,
  input: {
    actorType: "user" | "system" | "heartbeat";
    actorUserId?: string | null;
    statusFrom?: IncidentStatus | null;
    statusTo?: IncidentStatus | null;
    message?: string | null;
  },
  adminClient: AdminLike,
) {
  const { error } = await adminClient.from("incident_updates").insert({
    organization_id: incident.organizationId,
    incident_id: incident.id,
    actor_type: input.actorType,
    actor_user_id: input.actorUserId ?? null,
    status_from: input.statusFrom ?? null,
    status_to: input.statusTo ?? null,
    message: sanitizeIncidentText(input.message),
  });

  if (error) {
    throw mapPostgresError(error);
  }
}

function assertMutableIncident(incident: RawIncidentRecord) {
  if (incident.status === "resolved") {
    throw new ApiError(409, "INCIDENT_ALREADY_RESOLVED", "The incident has already been resolved.");
  }
}

function assertStatusTransition(current: IncidentStatus, next: IncidentStatus) {
  const allowedTransitions: Record<IncidentStatus, IncidentStatus[]> = {
    detected: ["open", "acknowledged", "investigating", "resolved"],
    open: ["acknowledged", "investigating", "resolved"],
    acknowledged: ["investigating", "monitoring", "resolved"],
    investigating: ["monitoring", "resolved"],
    monitoring: ["resolved", "open"],
    resolved: [],
  };

  if (!allowedTransitions[current].includes(next)) {
    throw new ApiError(409, "INVALID_INCIDENT_TRANSITION", "This incident transition is not allowed.");
  }
}

export async function listIncidentsForOrganization(
  userId: string,
  organizationId?: string,
  filter: IncidentListFilter = "active",
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeIncidentSummary[]> {
  const organizationContext = await requireOrgMembership(userId, organizationId, adminClient);
  const activeOrganizationId = organizationContext.organization.id;

  const { data, error } = await adminClient
    .from("incidents")
    .select(INCIDENT_SELECT)
    .eq("organization_id", activeOrganizationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw mapPostgresError(error);
  }

  const incidents = (data ?? []).map((row) => mapIncidentRow(row as unknown as IncidentLookupRow));
  const filtered = incidents.filter((incident) =>
    filter === "all"
      ? true
      : filter === "resolved"
        ? incident.status === "resolved"
        : incident.status !== "resolved",
  );
  const relations = await loadIncidentRelations(activeOrganizationId, filtered, adminClient);

  return filtered.map((incident) =>
    toSafeIncidentSummary(incident, relations.get(incident.id) ?? {
      appName: null,
      appSlug: null,
      monitorName: null,
      monitorSlug: null,
      environmentName: null,
    }),
  );
}

export async function getIncidentById(
  userId: string,
  incidentId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeIncidentDetail> {
  const { incident } = await getRawIncidentById(userId, incidentId, organizationId, adminClient);
  const [updatesResult, latestResultsResult, relations, linkedExternalIssues] = await Promise.all([
    adminClient
      .from("incident_updates")
      .select("id, actor_type, actor_user_id, status_from, status_to, message, created_at")
      .eq("organization_id", incident.organizationId)
      .eq("incident_id", incident.id)
      .order("created_at", { ascending: true }),
    adminClient
      .from("monitor_results")
      .select(
        "id, status, trigger_source, checked_at, duration_ms, http_status, error_code, error_message, response_excerpt, assertion_results, metadata",
      )
      .eq("organization_id", incident.organizationId)
      .eq("monitor_id", incident.monitorId)
      .order("checked_at", { ascending: false })
      .limit(5),
    loadIncidentRelations(incident.organizationId, [incident], adminClient),
    listLinkedExternalIssuesForIncident(userId, incident.id, incident.organizationId, adminClient),
  ]);

  if (updatesResult.error) {
    throw mapPostgresError(updatesResult.error);
  }
  if (latestResultsResult.error) {
    throw mapPostgresError(latestResultsResult.error);
  }

  return withLinkedExternalIssues(toSafeIncidentDetail(
    incident,
    relations.get(incident.id) ?? {
      appName: null,
      appSlug: null,
      monitorName: null,
      monitorSlug: null,
      environmentName: null,
    },
    ((updatesResult.data ?? []) as RawIncidentUpdateRow[]).map((row) => toSafeIncidentUpdate(row)),
    ((latestResultsResult.data ?? []) as Record<string, unknown>[]).map((row) => mapResultRow(row)),
  ), linkedExternalIssues);
}

export async function acknowledgeIncident(
  context: IncidentServiceContext,
  incidentId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { incident } = await getRawIncidentById(
    context.userId,
    incidentId,
    context.organization.id,
    adminClient,
  );

  assertMutableIncident(incident);

  if (!["detected", "open"].includes(incident.status)) {
    throw new ApiError(409, "INVALID_INCIDENT_TRANSITION", "Only detected or open incidents can be acknowledged.");
  }

  assertStatusTransition(incident.status, "acknowledged");
  const acknowledgedAt = new Date().toISOString();
  const patch = {
    status: "acknowledged",
    acknowledged_at: acknowledgedAt,
    last_state_change_at: acknowledgedAt,
  };

  const { error } = await adminClient
    .from("incidents")
    .update(patch)
    .eq("id", incident.id)
    .eq("organization_id", incident.organizationId);

  if (error) {
    throw mapPostgresError(error);
  }

  await appendIncidentUpdate(
    incident,
    {
      actorType: "user",
      actorUserId: context.userId,
      statusFrom: incident.status,
      statusTo: "acknowledged",
      message: "Incident acknowledged.",
    },
    adminClient,
  );

  await writeAuditLog({
    organizationId: incident.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "acknowledge",
    targetTable: "incidents",
    targetId: incident.id,
    metadata: {
      before: sanitizeIncidentForAudit(incident),
      after: {
        ...sanitizeIncidentForAudit(incident),
        status: "acknowledged",
        acknowledgedAt,
      },
    },
    request: context.request,
  });

  try {
    await queueIncidentAlertDeliveries(
      {
        incident: {
          ...incident,
          status: "acknowledged",
          acknowledgedAt,
          lastStateChangeAt: acknowledgedAt,
          updatedAt: acknowledgedAt,
        },
        eventType: "incident_acknowledged",
        eventTimestamp: acknowledgedAt,
      },
      adminClient,
    );
  } catch (queueError) {
    console.error("Failed to queue incident_acknowledged alerts", queueError);
  }

  return getIncidentById(context.userId, incident.id, incident.organizationId, adminClient);
}

export async function createUserIncidentUpdate(
  context: IncidentServiceContext,
  incidentId: string,
  input: CreateIncidentUpdateInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { incident } = await getRawIncidentById(
    context.userId,
    incidentId,
    context.organization.id,
    adminClient,
  );

  assertMutableIncident(incident);

  const nextStatus = input.statusTo;
  if (nextStatus) {
    assertStatusTransition(incident.status, nextStatus);
  }

  const rootCause = sanitizeIncidentText(input.rootCause);
  const resolutionNotes = sanitizeIncidentText(input.resolutionNotes);
  const message = sanitizeIncidentText(input.message);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (nextStatus) {
    patch.status = nextStatus;
    patch.last_state_change_at = now;
    if (nextStatus === "investigating" && !incident.openedAt) {
      patch.opened_at = now;
    }
    if (nextStatus === "monitoring") {
      patch.recovered_at = incident.recoveredAt ?? now;
    }
  }

  if (rootCause !== null) {
    patch.root_cause = rootCause;
  }

  if (resolutionNotes !== null) {
    patch.resolution_notes = resolutionNotes;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await adminClient
      .from("incidents")
      .update(patch)
      .eq("id", incident.id)
      .eq("organization_id", incident.organizationId);

    if (error) {
      throw mapPostgresError(error);
    }
  }

  await appendIncidentUpdate(
    incident,
    {
      actorType: "user",
      actorUserId: context.userId,
      statusFrom: nextStatus ? incident.status : null,
      statusTo: nextStatus ?? null,
      message,
    },
    adminClient,
  );

  await writeAuditLog({
    organizationId: incident.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "incidents",
    targetId: incident.id,
    metadata: {
      before: sanitizeIncidentForAudit(incident),
      update: {
        statusTo: nextStatus ?? null,
        rootCause,
        resolutionNotes,
        message,
      },
    },
    request: context.request,
  });

  try {
    await queueIncidentAlertDeliveries(
      {
        incident: {
          ...incident,
          status: nextStatus ?? incident.status,
          rootCause: rootCause ?? incident.rootCause,
          resolutionNotes: resolutionNotes ?? incident.resolutionNotes,
          lastStateChangeAt: nextStatus ? now : incident.lastStateChangeAt,
          updatedAt: now,
          recoveredAt:
            nextStatus === "monitoring" ? incident.recoveredAt ?? now : incident.recoveredAt,
          openedAt:
            nextStatus === "investigating" && !incident.openedAt ? now : incident.openedAt,
        },
        eventType: "incident_updated",
        eventTimestamp: now,
      },
      adminClient,
    );
  } catch (queueError) {
    console.error("Failed to queue incident_updated alerts", queueError);
  }

  return getIncidentById(context.userId, incident.id, incident.organizationId, adminClient);
}

export async function resolveIncident(
  context: IncidentServiceContext,
  incidentId: string,
  input: ResolveIncidentInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { incident } = await getRawIncidentById(
    context.userId,
    incidentId,
    context.organization.id,
    adminClient,
  );

  assertMutableIncident(incident);
  assertStatusTransition(incident.status, "resolved");

  const now = new Date().toISOString();
  const resolutionNotes =
    sanitizeIncidentText(input.resolutionNotes) ?? incident.resolutionNotes;
  const rootCause = sanitizeIncidentText(input.rootCause) ?? incident.rootCause;

  const { error } = await adminClient
    .from("incidents")
    .update({
      status: "resolved",
      resolved_at: now,
      recovered_at: incident.recoveredAt ?? now,
      resolution_notes: resolutionNotes,
      root_cause: rootCause,
      last_state_change_at: now,
    })
    .eq("id", incident.id)
    .eq("organization_id", incident.organizationId);

  if (error) {
    throw mapPostgresError(error);
  }

  await appendIncidentUpdate(
    incident,
    {
      actorType: "user",
      actorUserId: context.userId,
      statusFrom: incident.status,
      statusTo: "resolved",
      message: sanitizeIncidentText(input.message) ?? "Incident resolved.",
    },
    adminClient,
  );

  await writeAuditLog({
    organizationId: incident.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "resolve",
    targetTable: "incidents",
    targetId: incident.id,
    metadata: {
      before: sanitizeIncidentForAudit(incident),
      after: {
        ...sanitizeIncidentForAudit(incident),
        status: "resolved",
        resolvedAt: now,
        recoveredAt: incident.recoveredAt ?? now,
        resolutionNotes,
        rootCause,
      },
    },
    request: context.request,
  });

  try {
    await queueIncidentAlertDeliveries(
      {
        incident: {
          ...incident,
          status: "resolved",
          resolvedAt: now,
          recoveredAt: incident.recoveredAt ?? now,
          resolutionNotes,
          rootCause,
          lastStateChangeAt: now,
          updatedAt: now,
        },
        eventType: "incident_resolved",
        eventTimestamp: now,
      },
      adminClient,
    );
  } catch (queueError) {
    console.error("Failed to queue incident_resolved alerts", queueError);
  }

  return getIncidentById(context.userId, incident.id, incident.organizationId, adminClient);
}
