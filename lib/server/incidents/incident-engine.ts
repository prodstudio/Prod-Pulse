import "server-only";

import { mapPostgresError } from "@/lib/server/api/errors";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import { sanitizeIncidentForAudit, sanitizeIncidentText, sanitizeIncidentTitle, type RawIncidentRecord } from "@/lib/server/incidents/incident-sanitization";
import type { SafeMonitorResult } from "@/lib/server/monitoring/result-sanitization";
import type { RunnerMonitorRecord } from "@/lib/server/monitoring/runner-locks";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type IncidentStatus =
  | "detected"
  | "open"
  | "acknowledged"
  | "investigating"
  | "monitoring"
  | "resolved";

type IncidentSeverity = "info" | "warning" | "critical" | "emergency";

type IncidentEngineInput = {
  monitor: RunnerMonitorRecord;
  result: SafeMonitorResult;
  suppressedByMaintenanceWindowId?: string | null;
};

export type IncidentEngineOutcome = {
  created: boolean;
  updated: boolean;
  incidentId: string | null;
  action:
    | "noop"
    | "suppressed"
    | "created"
    | "opened"
    | "monitoring"
    | "resolved";
};

type RawResultStatusRow = {
  id: string;
  status: string;
};

const INCIDENT_ACTIVE_RESULT_STATUSES = new Set(["failure", "timeout", "error", "degraded"]);
const UNRESOLVED_STATES = ["detected", "open", "acknowledged", "investigating", "monitoring"];
const INCIDENT_DEDUPE_KEY = "primary_failure";

function mapIncidentRow(row: Record<string, unknown>): RawIncidentRecord {
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
    lastStateChangeAt: String(row.last_state_change_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function buildIncidentTitle(monitor: RunnerMonitorRecord, result: SafeMonitorResult) {
  if (result.status === "degraded") {
    return sanitizeIncidentTitle(`${monitor.name} is degraded`);
  }

  return sanitizeIncidentTitle(`${monitor.name} is down`);
}

function buildIncidentSummary(result: SafeMonitorResult) {
  return (
    sanitizeIncidentText(result.errorSummary) ??
    sanitizeIncidentText(result.metadataSummary) ??
    sanitizeIncidentText(result.responseSummary) ??
    (result.httpStatus != null ? `Latest check returned HTTP ${result.httpStatus}.` : "Latest scheduled check did not complete successfully.")
  );
}

function mapSeverity(result: SafeMonitorResult): IncidentSeverity {
  if (result.status === "degraded") {
    return "warning";
  }

  return "critical";
}

function getAutoResolveOnRecovery(monitor: RunnerMonitorRecord) {
  const configuration = monitor.configuration;
  const incidentConfig =
    configuration.incident && typeof configuration.incident === "object"
      ? (configuration.incident as Record<string, unknown>)
      : null;

  if (typeof incidentConfig?.autoResolveOnRecovery === "boolean") {
    return incidentConfig.autoResolveOnRecovery;
  }

  if (typeof configuration.autoResolveOnRecovery === "boolean") {
    return configuration.autoResolveOnRecovery;
  }

  return false;
}

async function getRecentScheduledStatuses(
  monitor: RunnerMonitorRecord,
  adminClient: AdminLike,
) {
  const limit = Math.max(monitor.consecutiveFailureThreshold, monitor.consecutiveRecoveryThreshold) * 4;
  const { data, error } = await adminClient
    .from("monitor_results")
    .select("id, status")
    .eq("organization_id", monitor.organizationId)
    .eq("monitor_id", monitor.id)
    .eq("trigger_source", "scheduled")
    .order("checked_at", { ascending: false })
    .limit(Math.max(limit, 12));

  if (error) {
    throw mapPostgresError(error);
  }

  return (data ?? []) as RawResultStatusRow[];
}

async function getUnresolvedIncident(
  monitor: RunnerMonitorRecord,
  adminClient: AdminLike,
) {
  const { data, error } = await adminClient
    .from("incidents")
    .select(
      "id, organization_id, app_id, environment_id, monitor_id, created_from_result_id, title, summary, severity, status, dedupe_key, assigned_to, opened_by, detected_at, opened_at, acknowledged_at, recovered_at, resolved_at, auto_resolve_on_recovery, root_cause, resolution_notes, last_state_change_at, created_at, updated_at",
    )
    .eq("organization_id", monitor.organizationId)
    .eq("monitor_id", monitor.id)
    .eq("dedupe_key", INCIDENT_DEDUPE_KEY)
    .in("status", UNRESOLVED_STATES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  return data ? mapIncidentRow(data as Record<string, unknown>) : null;
}

async function appendSystemIncidentUpdate(
  incident: RawIncidentRecord,
  statusFrom: IncidentStatus | null,
  statusTo: IncidentStatus | null,
  message: string,
  adminClient: AdminLike,
) {
  const { error } = await adminClient.from("incident_updates").insert({
    organization_id: incident.organizationId,
    incident_id: incident.id,
    actor_type: "system",
    actor_user_id: null,
    status_from: statusFrom,
    status_to: statusTo,
    message: sanitizeIncidentText(message),
    metadata: {},
  });

  if (error) {
    throw mapPostgresError(error);
  }
}

export async function processScheduledIncidentState(
  input: IncidentEngineInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<IncidentEngineOutcome> {
  const { monitor, result, suppressedByMaintenanceWindowId } = input;

  if (suppressedByMaintenanceWindowId && INCIDENT_ACTIVE_RESULT_STATUSES.has(result.status)) {
    return {
      created: false,
      updated: false,
      incidentId: null,
      action: "suppressed",
    };
  }

  const [recentStatuses, unresolvedIncident] = await Promise.all([
    getRecentScheduledStatuses(monitor, adminClient),
    getUnresolvedIncident(monitor, adminClient),
  ]);

  let consecutiveIncidentStatuses = 0;
  for (const status of recentStatuses) {
    if (!INCIDENT_ACTIVE_RESULT_STATUSES.has(status.status)) {
      break;
    }

    consecutiveIncidentStatuses += 1;
  }

  let consecutiveSuccessfulStatuses = 0;
  for (const status of recentStatuses) {
    if (status.status !== "success") {
      break;
    }

    consecutiveSuccessfulStatuses += 1;
  }

  if (INCIDENT_ACTIVE_RESULT_STATUSES.has(result.status)) {
    if (consecutiveIncidentStatuses < monitor.consecutiveFailureThreshold) {
      return {
        created: false,
        updated: false,
        incidentId: unresolvedIncident?.id ?? null,
        action: "noop",
      };
    }

    if (!unresolvedIncident) {
      const now = result.checkedAt;
      const incidentInsert = {
        organization_id: monitor.organizationId,
        app_id: monitor.appId,
        environment_id: monitor.environmentId,
        monitor_id: monitor.id,
        created_from_result_id: result.id,
        title: buildIncidentTitle(monitor, result),
        summary: buildIncidentSummary(result),
        severity: mapSeverity(result),
        status: "detected" as const,
        dedupe_key: INCIDENT_DEDUPE_KEY,
        opened_by: null,
        detected_at: now,
        auto_resolve_on_recovery: getAutoResolveOnRecovery(monitor),
        last_state_change_at: now,
      };

      const { data, error } = await adminClient
        .from("incidents")
        .insert(incidentInsert)
        .select(
          "id, organization_id, app_id, environment_id, monitor_id, created_from_result_id, title, summary, severity, status, dedupe_key, assigned_to, opened_by, detected_at, opened_at, acknowledged_at, recovered_at, resolved_at, auto_resolve_on_recovery, root_cause, resolution_notes, last_state_change_at, created_at, updated_at",
        )
        .single();

      if (error) {
        if (error.code === "23505") {
          return {
            created: false,
            updated: false,
            incidentId: (await getUnresolvedIncident(monitor, adminClient))?.id ?? null,
            action: "noop",
          };
        }

        throw mapPostgresError(error);
      }

      const incident = mapIncidentRow(data as Record<string, unknown>);
      await appendSystemIncidentUpdate(
        incident,
        null,
        "detected",
        `Incident detected after ${consecutiveIncidentStatuses} consecutive non-success scheduled checks.`,
        adminClient,
      );
      await writeAuditLog({
        organizationId: incident.organizationId,
        actorType: "system",
        actionType: "create",
        targetTable: "incidents",
        targetId: incident.id,
        metadata: {
          incident: sanitizeIncidentForAudit(incident),
          result: {
            id: result.id,
            status: result.status,
            checkedAt: result.checkedAt,
            errorCode: result.errorCode,
            httpStatus: result.httpStatus,
          },
        },
      });

      return {
        created: true,
        updated: false,
        incidentId: incident.id,
        action: "created",
      };
    }

    const nextStatus: IncidentStatus =
      unresolvedIncident.status === "detected" || unresolvedIncident.status === "monitoring"
        ? "open"
        : unresolvedIncident.status;
    const nextSeverity = mapSeverity(result);
    const nextTitle = buildIncidentTitle(monitor, result);
    const nextSummary = buildIncidentSummary(result);
    const patch: Record<string, unknown> = {
      severity: nextSeverity,
      title: nextTitle,
      summary: nextSummary,
      created_from_result_id: result.id,
      recovered_at: null,
    };

    if (nextStatus !== unresolvedIncident.status) {
      patch.status = nextStatus;
      patch.last_state_change_at = result.checkedAt;
      if (nextStatus === "open" && !unresolvedIncident.openedAt) {
        patch.opened_at = result.checkedAt;
      }
    }

    const { error } = await adminClient
      .from("incidents")
      .update(patch)
      .eq("id", unresolvedIncident.id)
      .eq("organization_id", unresolvedIncident.organizationId);

    if (error) {
      throw mapPostgresError(error);
    }

    if (nextStatus !== unresolvedIncident.status) {
      await appendSystemIncidentUpdate(
        unresolvedIncident,
        unresolvedIncident.status,
        nextStatus,
        nextStatus === "open"
          ? "Incident remains active after another scheduled failure."
          : "Incident updated by the scheduled incident engine.",
        adminClient,
      );
    }

    return {
      created: false,
      updated: true,
      incidentId: unresolvedIncident.id,
      action: nextStatus === "open" ? "opened" : "noop",
    };
  }

  if (result.status !== "success" || !unresolvedIncident) {
    return {
      created: false,
      updated: false,
      incidentId: unresolvedIncident?.id ?? null,
      action: "noop",
    };
  }

  if (consecutiveSuccessfulStatuses < monitor.consecutiveRecoveryThreshold) {
    return {
      created: false,
      updated: false,
      incidentId: unresolvedIncident.id,
      action: "noop",
    };
  }

  const nextStatus: IncidentStatus = unresolvedIncident.autoResolveOnRecovery
    ? "resolved"
    : "monitoring";

  if (nextStatus === unresolvedIncident.status) {
    return {
      created: false,
      updated: false,
      incidentId: unresolvedIncident.id,
      action: "noop",
    };
  }

  const patch: Record<string, unknown> = {
    status: nextStatus,
    recovered_at: result.checkedAt,
    last_state_change_at: result.checkedAt,
  };

  if (nextStatus === "resolved") {
    patch.resolved_at = result.checkedAt;
  }

  const { error } = await adminClient
    .from("incidents")
    .update(patch)
    .eq("id", unresolvedIncident.id)
    .eq("organization_id", unresolvedIncident.organizationId);

  if (error) {
    throw mapPostgresError(error);
  }

  await appendSystemIncidentUpdate(
    unresolvedIncident,
    unresolvedIncident.status,
    nextStatus,
    nextStatus === "resolved"
      ? `Incident auto-resolved after ${consecutiveSuccessfulStatuses} consecutive successful scheduled checks.`
      : `Incident moved to monitoring after ${consecutiveSuccessfulStatuses} consecutive successful scheduled checks.`,
    adminClient,
  );

  await writeAuditLog({
    organizationId: unresolvedIncident.organizationId,
    actorType: "system",
    actionType: nextStatus === "resolved" ? "resolve" : "recover",
    targetTable: "incidents",
    targetId: unresolvedIncident.id,
    metadata: {
      before: sanitizeIncidentForAudit(unresolvedIncident),
      after: {
        ...sanitizeIncidentForAudit(unresolvedIncident),
        status: nextStatus,
        recoveredAt: result.checkedAt,
        resolvedAt: nextStatus === "resolved" ? result.checkedAt : unresolvedIncident.resolvedAt,
      },
    },
  });

  return {
    created: false,
    updated: true,
    incidentId: unresolvedIncident.id,
    action: nextStatus === "resolved" ? "resolved" : "monitoring",
  };
}
