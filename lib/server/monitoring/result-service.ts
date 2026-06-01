import "server-only";

import { mapPostgresError } from "@/lib/server/api/errors";
import { requireResourceAccess } from "@/lib/server/auth/organization-context";
import type { RawMonitorRecord } from "@/lib/server/monitors/monitor-sanitization";
import {
  sanitizeAssertionResults,
  sanitizeResultMetadata,
  sanitizeStoredErrorMessage,
  sanitizeStoredResponseExcerpt,
  toSafeMonitorResult,
  type SafeMonitorResult,
} from "@/lib/server/monitoring/result-sanitization";
import type { MonitorExecutionResult } from "@/lib/server/monitoring/evaluate";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type PersistMonitorExecutionInput = {
  actorUserId: string;
  monitor: RawMonitorRecord;
  execution: MonitorExecutionResult;
};

type PersistExecutionOptions = {
  triggerSource: "manual" | "scheduled" | "heartbeat" | "retry";
  runnerRunId?: string | null;
  idempotencyKey?: string | null;
  suppressedByMaintenanceWindowId?: string | null;
};

type PersistExecutionResult = {
  result: SafeMonitorResult;
  duplicate: boolean;
};

type ListMonitorResultsOptions = {
  limit?: number;
};

type RawMonitorResultRow = {
  id: string;
  status: string;
  trigger_source: string;
  checked_at: string;
  duration_ms: number | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  response_excerpt: string | null;
  assertion_results: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

function mapRawMonitorResultRow(row: RawMonitorResultRow) {
  return {
    id: row.id,
    status: row.status,
    triggerSource: row.trigger_source,
    checkedAt: row.checked_at,
    durationMs: row.duration_ms,
    httpStatus: row.http_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    responseExcerpt: row.response_excerpt,
    assertionResults: row.assertion_results ?? {},
    metadata: row.metadata ?? {},
  };
}

export function buildMonitorStatePatch(_monitor: RawMonitorRecord, execution: MonitorExecutionResult) {
  const basePatch: Record<string, unknown> = {
    last_checked_at: execution.checkedAt,
  };

  if (execution.status === "success") {
    return {
      ...basePatch,
      last_success_at: execution.checkedAt,
    };
  }

  if (execution.status === "degraded") {
    return {
      ...basePatch,
      last_success_at: execution.checkedAt,
    };
  }

  if (execution.status === "failure" || execution.status === "timeout" || execution.status === "error") {
    return {
      ...basePatch,
      last_failure_at: execution.checkedAt,
    };
  }

  return basePatch;
}

async function getExistingResultByIdempotencyKey(
  organizationId: string,
  idempotencyKey: string,
  adminClient: AdminLike,
): Promise<SafeMonitorResult> {
  const { data, error } = await adminClient
    .from("monitor_results")
    .select(
      "id, status, trigger_source, checked_at, duration_ms, http_status, error_code, error_message, response_excerpt, assertion_results, metadata",
    )
    .eq("organization_id", organizationId)
    .eq("idempotency_key", idempotencyKey)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  return toSafeMonitorResult(mapRawMonitorResultRow(data as RawMonitorResultRow));
}

async function persistExecutionResult(
  input: PersistMonitorExecutionInput,
  options: PersistExecutionOptions,
  adminClient: AdminLike,
): Promise<PersistExecutionResult> {
  const safeAssertionResults = sanitizeAssertionResults(input.execution.assertionResults);
  const safeMetadata = sanitizeResultMetadata(input.execution.metadata);

  const { data, error } = await adminClient
    .from("monitor_results")
    .insert({
      organization_id: input.monitor.organizationId,
      monitor_id: input.monitor.id,
      app_id: input.monitor.appId,
      environment_id: input.monitor.environmentId,
      runner_run_id: options.runnerRunId ?? null,
      trigger_source: options.triggerSource,
      status: input.execution.status,
      idempotency_key: options.idempotencyKey ?? null,
      checked_at: input.execution.checkedAt,
      started_at: input.execution.startedAt,
      finished_at: input.execution.finishedAt,
      duration_ms: input.execution.durationMs,
      http_status: input.execution.httpStatus,
      error_code: input.execution.errorCode,
      error_message: sanitizeStoredErrorMessage(input.execution.errorMessage),
      response_excerpt: sanitizeStoredResponseExcerpt(input.execution.responseExcerpt),
      assertion_results: safeAssertionResults,
      metadata: safeMetadata,
      suppressed_by_maintenance_window_id: options.suppressedByMaintenanceWindowId ?? null,
    })
    .select(
      "id, status, trigger_source, checked_at, duration_ms, http_status, error_code, error_message, response_excerpt, assertion_results, metadata",
    )
    .single();

  if (error) {
    if (error.code === "23505" && options.idempotencyKey) {
      return {
        result: await getExistingResultByIdempotencyKey(
          input.monitor.organizationId,
          options.idempotencyKey,
          adminClient,
        ),
        duplicate: true,
      };
    }

    throw mapPostgresError(error);
  }

  if (input.execution.attempts.length > 0) {
    const { error: attemptsError } = await adminClient.from("monitor_result_attempts").insert(
      input.execution.attempts.map((attempt) => ({
        organization_id: input.monitor.organizationId,
        monitor_result_id: data.id,
        attempt_number: attempt.attemptNumber,
        status: attempt.status,
        started_at: attempt.startedAt,
        finished_at: attempt.finishedAt,
        duration_ms: attempt.durationMs,
        http_status: attempt.httpStatus,
        error_code: attempt.errorCode,
        error_message: sanitizeStoredErrorMessage(attempt.errorMessage),
      })),
    );

    if (attemptsError) {
      throw mapPostgresError(attemptsError);
    }
  }

  return {
    result: toSafeMonitorResult(mapRawMonitorResultRow(data as RawMonitorResultRow)),
    duplicate: false,
  };
}

export async function persistMonitorExecutionResult(
  input: PersistMonitorExecutionInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeMonitorResult> {
  const persisted = await persistExecutionResult(
    input,
    {
      triggerSource: "manual",
    },
    adminClient,
  );

  const { error: monitorUpdateError } = await adminClient
    .from("monitors")
    .update(buildMonitorStatePatch(input.monitor, input.execution))
    .eq("id", input.monitor.id)
    .eq("organization_id", input.monitor.organizationId);

  if (monitorUpdateError) {
    throw mapPostgresError(monitorUpdateError);
  }

  return persisted.result;
}

export async function persistScheduledMonitorExecutionResult(
  input: PersistMonitorExecutionInput,
  options: Omit<PersistExecutionOptions, "triggerSource">,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<PersistExecutionResult> {
  return persistExecutionResult(
    input,
    {
      ...options,
      triggerSource: "scheduled",
    },
    adminClient,
  );
}

export async function listMonitorResultsForMonitor(
  userId: string,
  monitorId: string,
  organizationId?: string,
  options: ListMonitorResultsOptions = {},
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeMonitorResult[]> {
  const { organizationContext, resource } = await requireResourceAccess(
    userId,
    "monitor",
    monitorId,
    organizationId,
    adminClient,
  );
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  const { data, error } = await adminClient
    .from("monitor_results")
    .select(
      "id, status, trigger_source, checked_at, duration_ms, http_status, error_code, error_message, response_excerpt, assertion_results, metadata",
    )
    .eq("organization_id", organizationContext.organization.id)
    .eq("monitor_id", resource.id)
    .order("checked_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw mapPostgresError(error);
  }

  return (data ?? []).map((row) =>
    toSafeMonitorResult(mapRawMonitorResultRow(row as RawMonitorResultRow)),
  );
}
