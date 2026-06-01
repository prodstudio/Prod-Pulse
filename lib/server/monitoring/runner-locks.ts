import "server-only";

import { mapPostgresError } from "@/lib/server/api/errors";
import type { RawMonitorRecord } from "@/lib/server/monitors/monitor-sanitization";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

const RUNNER_MONITOR_SELECT =
  "id, organization_id, app_id, environment_id, name, slug, type, status, is_enabled, request_method, target_url, expected_status_codes, interval_seconds, next_check_at, timeout_ms, latency_threshold_ms, consecutive_failure_threshold, consecutive_recovery_threshold, consecutive_failures, consecutive_successes, configuration, description, created_at, updated_at, last_checked_at, last_success_at, last_failure_at, last_scheduled_bucket, locked_at, lock_expires_at, locked_by_run_id";

const DB_MONITOR_TYPE_TO_PUBLIC = {
  http_uptime: "http",
  api_health_endpoint: "api_health",
  json_assertion: "json_assertion",
  latency_threshold: "latency_threshold",
  ssl_expiry: "ssl_expiry",
  heartbeat_freshness: "heartbeat",
} as const;

export type RunnerMonitorRecord = RawMonitorRecord & {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastScheduledBucket: string | null;
  lockedAt: string | null;
  lockExpiresAt: string | null;
  lockedByRunId: string | null;
};

function mapRunnerMonitorRow(row: Record<string, unknown>): RunnerMonitorRecord {
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
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    consecutiveSuccesses: Number(row.consecutive_successes ?? 0),
    configuration: (row.configuration as Record<string, unknown> | null) ?? {},
    description: (row.description as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastCheckedAt: (row.last_checked_at as string | null) ?? null,
    lastSuccessAt: (row.last_success_at as string | null) ?? null,
    lastFailureAt: (row.last_failure_at as string | null) ?? null,
    lastScheduledBucket: (row.last_scheduled_bucket as string | null) ?? null,
    lockedAt: (row.locked_at as string | null) ?? null,
    lockExpiresAt: (row.lock_expires_at as string | null) ?? null,
    lockedByRunId: (row.locked_by_run_id as string | null) ?? null,
  };
}

export async function selectDueMonitorCandidates(
  now: Date,
  batchSize: number,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<RunnerMonitorRecord[]> {
  const nowIso = now.toISOString();

  const { data, error } = await adminClient
    .from("monitors")
    .select(RUNNER_MONITOR_SELECT)
    .eq("is_enabled", true)
    .lte("next_check_at", nowIso)
    .or(`lock_expires_at.is.null,lock_expires_at.lt.${nowIso}`)
    .order("next_check_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    throw mapPostgresError(error);
  }

  return (data ?? []).map((row) => mapRunnerMonitorRow(row as Record<string, unknown>));
}

export async function acquireMonitorLock(
  monitorId: string,
  organizationId: string,
  runId: string,
  now: Date,
  lockTtlMs: number,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<RunnerMonitorRecord | null> {
  const nowIso = now.toISOString();
  const lockExpiresAt = new Date(now.getTime() + lockTtlMs).toISOString();

  const { data, error } = await adminClient
    .from("monitors")
    .update({
      locked_at: nowIso,
      lock_expires_at: lockExpiresAt,
      locked_by_run_id: runId,
    })
    .eq("id", monitorId)
    .eq("organization_id", organizationId)
    .eq("is_enabled", true)
    .lte("next_check_at", nowIso)
    .or(`lock_expires_at.is.null,lock_expires_at.lt.${nowIso}`)
    .select(RUNNER_MONITOR_SELECT)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  return data ? mapRunnerMonitorRow(data as Record<string, unknown>) : null;
}

export async function releaseMonitorLock(
  monitorId: string,
  organizationId: string,
  runId: string,
  patch: Record<string, unknown>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { error } = await adminClient
    .from("monitors")
    .update({
      ...patch,
      locked_at: null,
      lock_expires_at: null,
      locked_by_run_id: null,
    })
    .eq("id", monitorId)
    .eq("organization_id", organizationId)
    .eq("locked_by_run_id", runId);

  if (error) {
    throw mapPostgresError(error);
  }
}

export async function clearMonitorLock(
  monitorId: string,
  organizationId: string,
  runId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  return releaseMonitorLock(monitorId, organizationId, runId, {}, adminClient);
}
