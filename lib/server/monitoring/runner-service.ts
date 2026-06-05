import "server-only";

import { evaluateMonitor, type MonitorExecutionResult } from "@/lib/server/monitoring/evaluate";
import {
  acquireMonitorLock,
  clearMonitorLock,
  releaseMonitorLock,
  selectDueMonitorCandidates,
  type RunnerMonitorRecord,
} from "@/lib/server/monitoring/runner-locks";
import { persistScheduledMonitorExecutionResult } from "@/lib/server/monitoring/result-service";
import type { SafeMonitorResult } from "@/lib/server/monitoring/result-sanitization";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";
import { mapPostgresError } from "@/lib/server/api/errors";
import { processScheduledIncidentState } from "@/lib/server/incidents/incident-engine";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type RunnerDependencies = {
  acquireMonitorLockImpl?: typeof acquireMonitorLock;
  clearMonitorLockImpl?: typeof clearMonitorLock;
  evaluateMonitorImpl?: typeof evaluateMonitor;
  now?: Date;
  persistScheduledMonitorExecutionResultImpl?: typeof persistScheduledMonitorExecutionResult;
  processScheduledIncidentStateImpl?: typeof processScheduledIncidentState;
  releaseMonitorLockImpl?: typeof releaseMonitorLock;
  selectDueMonitorCandidatesImpl?: typeof selectDueMonitorCandidates;
};

export type MonitorRunnerSummary = {
  runId: string;
  dueCount: number;
  executedCount: number;
  skippedCount: number;
  failedCount: number;
  incidentCreatedCount: number;
  incidentUpdatedCount: number;
  durationMs: number;
};

type PersistedRunnerSummary = Pick<
  MonitorRunnerSummary,
  "dueCount" | "executedCount" | "skippedCount" | "failedCount" | "durationMs"
>;

export type RunScheduledMonitorRunnerOptions = {
  batchSize?: number;
  lockTtlMs?: number;
};

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LOCK_TTL_MS = 2 * 60 * 1000;

export function buildMonitorResultIdempotencyKey(monitor: RunnerMonitorRecord, bucketIso: string) {
  return `${monitor.organizationId}:${monitor.id}:${bucketIso}`;
}

export function buildNextCheckAt(
  intervalSeconds: number,
  referenceTime: Date,
  fromIso?: string | null,
) {
  const baseTime = fromIso ? new Date(fromIso).getTime() : referenceTime.getTime();
  let nextTime = baseTime + intervalSeconds * 1000;

  while (nextTime <= referenceTime.getTime()) {
    nextTime += intervalSeconds * 1000;
  }

  return new Date(nextTime).toISOString();
}

export function buildScheduledMonitorStatePatch(
  monitor: RunnerMonitorRecord,
  execution: MonitorExecutionResult,
  referenceTime: Date,
  scheduledBucketIso: string,
) {
  const nextCheckAt = buildNextCheckAt(
    monitor.intervalSeconds,
    referenceTime,
    monitor.nextCheckAt ?? scheduledBucketIso,
  );

  const basePatch: Record<string, unknown> = {
    next_check_at: nextCheckAt,
    last_scheduled_bucket: scheduledBucketIso,
    last_checked_at: execution.checkedAt,
  };

  if (execution.status === "success") {
    const nextConsecutiveSuccesses = monitor.consecutiveSuccesses + 1;
    return {
      ...basePatch,
      last_success_at: execution.checkedAt,
      consecutive_failures: 0,
      consecutive_successes: nextConsecutiveSuccesses,
      status:
        monitor.status === "down" || monitor.status === "degraded"
          ? nextConsecutiveSuccesses >= monitor.consecutiveRecoveryThreshold
            ? "operational"
            : monitor.status
          : "operational",
    };
  }

  if (execution.status === "degraded") {
    return {
      ...basePatch,
      last_success_at: execution.checkedAt,
      consecutive_failures: 0,
      consecutive_successes: 0,
      status: "degraded",
    };
  }

  if (
    execution.status === "failure" ||
    execution.status === "timeout" ||
    execution.status === "error"
  ) {
    const nextConsecutiveFailures = monitor.consecutiveFailures + 1;

    return {
      ...basePatch,
      last_failure_at: execution.checkedAt,
      consecutive_failures: nextConsecutiveFailures,
      consecutive_successes: 0,
      status:
        nextConsecutiveFailures >= monitor.consecutiveFailureThreshold
          ? "down"
          : monitor.status,
    };
  }

  return {
    ...basePatch,
    consecutive_successes: monitor.consecutiveSuccesses,
    consecutive_failures: monitor.consecutiveFailures,
  };
}

function createUnexpectedExecutionResult(now: Date): MonitorExecutionResult {
  const checkedAt = now.toISOString();

  return {
    status: "error",
    checkedAt,
    startedAt: checkedAt,
    finishedAt: checkedAt,
    durationMs: 0,
    httpStatus: null,
    errorCode: "RUNNER_EXECUTION_FAILED",
    errorMessage: "The scheduled monitor run could not be completed.",
    responseExcerpt: null,
    assertionResults: {},
    metadata: {
      note: "Scheduled runner execution failed before evaluation completed",
    },
    attempts: [],
  };
}

function toExecutionResultForStateUpdate(
  result: SafeMonitorResult,
  fallback: MonitorExecutionResult,
): MonitorExecutionResult {
  return {
    ...fallback,
    status: result.status as MonitorExecutionResult["status"],
    checkedAt: result.checkedAt,
    startedAt: fallback.startedAt,
    finishedAt: fallback.finishedAt,
    durationMs: result.durationMs,
    httpStatus: result.httpStatus,
    errorCode: result.errorCode,
    errorMessage: result.errorSummary,
    responseExcerpt: result.responseSummary,
    assertionResults: fallback.assertionResults,
    metadata: fallback.metadata,
  };
}

async function createRunnerRun(adminClient: AdminLike) {
  const { data, error } = await adminClient
    .from("runner_runs")
    .insert({
      actor_type: "system",
      trigger_source: "vercel_cron",
      status: "running",
    })
    .select("id, started_at")
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  return {
    id: String(data.id),
    startedAt: String(data.started_at),
  };
}

async function completeRunnerRun(
  runId: string,
  summary: PersistedRunnerSummary,
  failureSummary: Array<Record<string, string | number | null>>,
  adminClient: AdminLike,
) {
  const { error } = await adminClient
    .from("runner_runs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      total_monitors_selected: summary.dueCount,
      total_monitors_processed: summary.executedCount,
      total_monitors_failed: summary.failedCount,
      total_monitors_skipped: summary.skippedCount,
      failure_summary: failureSummary,
    })
    .eq("id", runId);

  if (error) {
    throw mapPostgresError(error);
  }
}

async function markRunnerRunFailed(
  runId: string,
  summary: PersistedRunnerSummary,
  adminClient: AdminLike,
) {
  const { error } = await adminClient
    .from("runner_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      total_monitors_selected: summary.dueCount,
      total_monitors_processed: summary.executedCount,
      total_monitors_failed: summary.failedCount,
      total_monitors_skipped: summary.skippedCount,
    })
    .eq("id", runId);

  if (error) {
    throw mapPostgresError(error);
  }
}

async function findActiveMaintenanceWindowId(
  monitor: RunnerMonitorRecord,
  checkedAtIso: string,
  adminClient: AdminLike,
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("maintenance_windows")
    .select("id, scope, app_id, environment_id, monitor_id")
    .eq("organization_id", monitor.organizationId)
    .lte("starts_at", checkedAtIso)
    .gte("ends_at", checkedAtIso)
    .order("created_at", { ascending: false });

  if (error) {
    throw mapPostgresError(error);
  }

  const window = (data ?? []).find((candidate) => {
    const record = candidate as {
      id: string;
      scope: string;
      app_id: string | null;
      environment_id: string | null;
      monitor_id: string | null;
    };

    if (record.scope === "organization") {
      return true;
    }

    if (record.scope === "app") {
      return record.app_id === monitor.appId;
    }

    if (record.scope === "environment") {
      return record.environment_id === monitor.environmentId;
    }

    if (record.scope === "monitor") {
      return record.monitor_id === monitor.id;
    }

    return false;
  });

  return window ? String((window as { id: string }).id) : null;
}

export async function runScheduledMonitorRunner(
  options: RunScheduledMonitorRunnerOptions = {},
  dependencies: RunnerDependencies = {},
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<MonitorRunnerSummary> {
  const batchSize = Math.min(Math.max(options.batchSize ?? DEFAULT_BATCH_SIZE, 1), 25);
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const now = dependencies.now ?? new Date();
  const run = await createRunnerRun(adminClient);
  const startedAt = new Date(run.startedAt);

  const summary: MonitorRunnerSummary = {
    runId: run.id,
    dueCount: 0,
    executedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    incidentCreatedCount: 0,
    incidentUpdatedCount: 0,
    durationMs: 0,
  };
  const failureSummary: Array<Record<string, string | number | null>> = [];

  const selectDueMonitorCandidatesImpl =
    dependencies.selectDueMonitorCandidatesImpl ?? selectDueMonitorCandidates;
  const acquireMonitorLockImpl = dependencies.acquireMonitorLockImpl ?? acquireMonitorLock;
  const releaseMonitorLockImpl = dependencies.releaseMonitorLockImpl ?? releaseMonitorLock;
  const clearMonitorLockImpl = dependencies.clearMonitorLockImpl ?? clearMonitorLock;
  const evaluateMonitorImpl = dependencies.evaluateMonitorImpl ?? evaluateMonitor;
  const persistScheduledMonitorExecutionResultImpl =
    dependencies.persistScheduledMonitorExecutionResultImpl ??
    persistScheduledMonitorExecutionResult;
  const processScheduledIncidentStateImpl =
    dependencies.processScheduledIncidentStateImpl ?? processScheduledIncidentState;

  try {
    const dueMonitors = await selectDueMonitorCandidatesImpl(now, batchSize, adminClient);
    summary.dueCount = dueMonitors.length;

    for (const candidate of dueMonitors) {
      const lockAcquiredAt = new Date();
      const lockTtlForMonitor = Math.max(
        lockTtlMs,
        candidate.timeoutMs * 3 + 30_000,
      );
      const lockedMonitor = await acquireMonitorLockImpl(
        candidate.id,
        candidate.organizationId,
        run.id,
        lockAcquiredAt,
        lockTtlForMonitor,
        adminClient,
      );

      if (!lockedMonitor) {
        summary.skippedCount += 1;
        failureSummary.push({
          monitorId: candidate.id,
          status: "skipped",
          reason: "lock_not_acquired",
        });
        continue;
      }

      const scheduledBucketIso = lockedMonitor.nextCheckAt ?? lockAcquiredAt.toISOString();
      const idempotencyKey = buildMonitorResultIdempotencyKey(lockedMonitor, scheduledBucketIso);

      try {
        let execution = await evaluateMonitorImpl(lockedMonitor);
        const suppressedWindowId = await findActiveMaintenanceWindowId(
          lockedMonitor,
          execution.checkedAt,
          adminClient,
        );

        if (suppressedWindowId) {
          execution = {
            ...execution,
            metadata: {
              ...execution.metadata,
              note: "Executed during an active maintenance window.",
            },
          };
        }

        const persisted = await persistScheduledMonitorExecutionResultImpl(
          {
            actorUserId: "system",
            monitor: lockedMonitor,
            execution,
          },
          {
            runnerRunId: run.id,
            idempotencyKey,
            suppressedByMaintenanceWindowId: suppressedWindowId,
          },
          adminClient,
        );

        const executionForStateUpdate = persisted.duplicate
          ? toExecutionResultForStateUpdate(persisted.result, execution)
          : execution;

        const patch = buildScheduledMonitorStatePatch(
          lockedMonitor,
          executionForStateUpdate,
          new Date(executionForStateUpdate.checkedAt),
          scheduledBucketIso,
        );

        await releaseMonitorLockImpl(
          lockedMonitor.id,
          lockedMonitor.organizationId,
          run.id,
          patch,
          adminClient,
        );

        const resultStatus = persisted.result.status;

        summary.executedCount += 1;
        if (resultStatus === "failure" || resultStatus === "timeout" || resultStatus === "error") {
          summary.failedCount += 1;
          failureSummary.push({
            monitorId: lockedMonitor.id,
            errorCode: persisted.result.errorCode,
            status: resultStatus,
          });
        }

        try {
          const incidentOutcome = await processScheduledIncidentStateImpl(
            {
              monitor: lockedMonitor,
              result: persisted.result,
              suppressedByMaintenanceWindowId: suppressedWindowId,
            },
            adminClient,
          );

          if (incidentOutcome.created) {
            summary.incidentCreatedCount += 1;
          }
          if (incidentOutcome.updated) {
            summary.incidentUpdatedCount += 1;
          }
        } catch (incidentError) {
          console.error("Scheduled incident processing failed", incidentError);
        }
      } catch (error) {
        const fallbackExecution = createUnexpectedExecutionResult(now);
        let executionForStateUpdate = fallbackExecution;
        let resultStatus: string = fallbackExecution.status;
        let resultErrorCode: string | null = fallbackExecution.errorCode;

        try {
          const persistedFallback = await persistScheduledMonitorExecutionResultImpl(
            {
              actorUserId: "system",
              monitor: lockedMonitor,
              execution: fallbackExecution,
            },
            {
              runnerRunId: run.id,
              idempotencyKey,
            },
            adminClient,
          );

          if (persistedFallback.duplicate) {
            executionForStateUpdate = toExecutionResultForStateUpdate(
              persistedFallback.result,
              fallbackExecution,
            );
          }

          resultStatus = persistedFallback.result.status;
          resultErrorCode = persistedFallback.result.errorCode;
        } catch (persistError) {
          console.error("Failed to persist scheduled monitor fallback result", persistError);
        }

        try {
          const patch = buildScheduledMonitorStatePatch(
            lockedMonitor,
            executionForStateUpdate,
            new Date(executionForStateUpdate.checkedAt),
            scheduledBucketIso,
          );
          await releaseMonitorLockImpl(
            lockedMonitor.id,
            lockedMonitor.organizationId,
            run.id,
            patch,
            adminClient,
          );
        } catch (releaseError) {
          console.error("Failed to release monitor lock after scheduled run error", releaseError);
          await clearMonitorLockImpl(
            lockedMonitor.id,
            lockedMonitor.organizationId,
            run.id,
            adminClient,
          ).catch(() => undefined);
        }

        summary.executedCount += 1;
        if (resultStatus === "failure" || resultStatus === "timeout" || resultStatus === "error") {
          summary.failedCount += 1;
          failureSummary.push({
            monitorId: lockedMonitor.id,
            errorCode: resultErrorCode,
            status: resultStatus,
          });
        }
        console.error("Scheduled monitor execution failed", error);
      }
    }

    summary.durationMs = Math.max(0, Date.now() - startedAt.getTime());
    await completeRunnerRun(run.id, {
      dueCount: summary.dueCount,
      executedCount: summary.executedCount,
      skippedCount: summary.skippedCount,
      failedCount: summary.failedCount,
      durationMs: summary.durationMs,
    }, failureSummary, adminClient);

    return summary;
  } catch (error) {
    summary.durationMs = Math.max(0, Date.now() - startedAt.getTime());
    await markRunnerRunFailed(
      run.id,
      {
        dueCount: summary.dueCount,
        executedCount: summary.executedCount,
        skippedCount: summary.skippedCount,
        failedCount: summary.failedCount,
        durationMs: summary.durationMs,
      },
      adminClient,
    ).catch(() => undefined);
    throw error;
  }
}
