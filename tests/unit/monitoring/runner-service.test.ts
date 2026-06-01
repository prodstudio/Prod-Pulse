import { describe, expect, it, vi } from "vitest";

import {
  buildMonitorResultIdempotencyKey,
  buildNextCheckAt,
  buildScheduledMonitorStatePatch,
  runScheduledMonitorRunner,
  type MonitorRunnerSummary,
} from "@/lib/server/monitoring/runner-service";
import type { RunnerMonitorRecord } from "@/lib/server/monitoring/runner-locks";
import type { MonitorExecutionResult } from "@/lib/server/monitoring/evaluate";

function createRunnerRunsChain() {
  return {
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: "run-1",
        started_at: "2026-06-01T00:00:00Z",
      },
      error: null,
    }),
    eq: vi.fn().mockResolvedValue({ error: null }),
  };
}

function createMaintenanceChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
}

function createAdminClient(tablesSeen: string[] = []) {
  const runnerRunsChain = createRunnerRunsChain();
  const maintenanceChain = createMaintenanceChain();

  return {
    runnerRunsChain,
    maintenanceChain,
    client: {
      from: vi.fn((table: string) => {
        tablesSeen.push(table);

        if (table === "runner_runs") {
          return runnerRunsChain;
        }

        if (table === "maintenance_windows") {
          return maintenanceChain;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

function createMonitor(overrides: Partial<RunnerMonitorRecord> = {}): RunnerMonitorRecord {
  return {
    id: "monitor-1",
    organizationId: "org-1",
    appId: "app-1",
    environmentId: "env-1",
    name: "Health",
    slug: "health",
    type: "http",
    status: "unknown",
    isEnabled: true,
    requestMethod: "GET",
    targetUrl: "https://example.com/health",
    expectedStatusCodes: [200],
    intervalSeconds: 300,
    nextCheckAt: "2026-06-01T00:00:00Z",
    timeoutMs: 10000,
    latencyThresholdMs: null,
    consecutiveFailureThreshold: 3,
    consecutiveRecoveryThreshold: 2,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    configuration: {},
    description: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastScheduledBucket: null,
    lockedAt: null,
    lockExpiresAt: null,
    lockedByRunId: null,
    ...overrides,
  };
}

function createExecutionResult(
  overrides: Partial<MonitorExecutionResult> = {},
): MonitorExecutionResult {
  return {
    status: "success",
    checkedAt: "2026-06-01T00:00:10Z",
    startedAt: "2026-06-01T00:00:00Z",
    finishedAt: "2026-06-01T00:00:10Z",
    durationMs: 10000,
    httpStatus: 200,
    errorCode: null,
    errorMessage: null,
    responseExcerpt: "ok",
    assertionResults: {},
    metadata: {},
    attempts: [],
    ...overrides,
  };
}

describe("runner service", () => {
  it("builds org-global idempotency keys", () => {
    expect(buildMonitorResultIdempotencyKey(createMonitor(), "2026-06-01T00:00:00Z")).toBe(
      "org-1:monitor-1:2026-06-01T00:00:00Z",
    );
  });

  it("advances next_check_at past now", () => {
    expect(
      buildNextCheckAt(300, new Date("2026-06-01T00:07:00Z"), "2026-06-01T00:00:00Z"),
    ).toBe("2026-06-01T00:10:00.000Z");
  });

  it("advances next_check_at past the actual completion time for long-running executions", () => {
    const patch = buildScheduledMonitorStatePatch(
      createMonitor({ nextCheckAt: "2026-06-01T00:00:00Z" }),
      createExecutionResult({ checkedAt: "2026-06-01T00:09:30Z" }),
      new Date("2026-06-01T00:09:30Z"),
      "2026-06-01T00:00:00Z",
    );

    expect(patch).toMatchObject({
      next_check_at: "2026-06-01T00:10:00.000Z",
    });
  });

  it("respects thresholds when building scheduled status updates", () => {
    const monitor = createMonitor({
      status: "operational",
      consecutiveFailures: 2,
      consecutiveFailureThreshold: 3,
      consecutiveSuccesses: 1,
      consecutiveRecoveryThreshold: 2,
    });

    const failurePatch = buildScheduledMonitorStatePatch(
      monitor,
      createExecutionResult({ status: "failure", errorCode: "HTTP_503" }),
      new Date("2026-06-01T00:10:00Z"),
      "2026-06-01T00:05:00Z",
    );
    const recoveryPatch = buildScheduledMonitorStatePatch(
      createMonitor({
        status: "down",
        consecutiveFailures: 3,
        consecutiveSuccesses: 1,
        consecutiveRecoveryThreshold: 2,
      }),
      createExecutionResult(),
      new Date("2026-06-01T00:10:00Z"),
      "2026-06-01T00:05:00Z",
    );

    expect(failurePatch).toMatchObject({
      status: "down",
      consecutive_failures: 3,
      consecutive_successes: 0,
    });
    expect(recoveryPatch).toMatchObject({
      status: "operational",
      consecutive_successes: 2,
      consecutive_failures: 0,
    });
  });

  it("skips locked monitors and respects the batch size limit", async () => {
    const tablesSeen: string[] = [];
    const admin = createAdminClient(tablesSeen);
    const selectDueMonitorCandidatesImpl = vi.fn().mockResolvedValue([
      createMonitor({ id: "monitor-1" }),
      createMonitor({ id: "monitor-2", slug: "m2" }),
    ]);
    const acquireMonitorLockImpl = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createMonitor({ id: "monitor-2", slug: "m2" }));
    const evaluateMonitorImpl = vi.fn().mockResolvedValue(createExecutionResult());
    const persistScheduledMonitorExecutionResultImpl = vi.fn().mockResolvedValue({
      result: {
        id: "result-2",
        status: "success",
        triggerSource: "scheduled",
        checkedAt: "2026-06-01T00:00:10Z",
        durationMs: 10000,
        httpStatus: 200,
        errorCode: null,
        errorSummary: null,
        responseSummary: null,
        assertionSummary: null,
        metadataSummary: null,
      },
      duplicate: false,
    });
    const releaseMonitorLockImpl = vi.fn().mockResolvedValue(undefined);

    const summary = await runScheduledMonitorRunner(
      { batchSize: 2 },
      {
        now: new Date("2026-06-01T00:00:00Z"),
        selectDueMonitorCandidatesImpl,
        acquireMonitorLockImpl,
        evaluateMonitorImpl,
        persistScheduledMonitorExecutionResultImpl,
        releaseMonitorLockImpl,
      },
      admin.client as never,
    );

    expect(summary).toMatchObject<Partial<MonitorRunnerSummary>>({
      runId: "run-1",
      dueCount: 2,
      executedCount: 1,
      skippedCount: 1,
      failedCount: 0,
    });
    expect(selectDueMonitorCandidatesImpl).toHaveBeenCalledWith(
      new Date("2026-06-01T00:00:00Z"),
      2,
      admin.client,
    );
    expect(releaseMonitorLockImpl).toHaveBeenCalledTimes(1);
    expect(tablesSeen).not.toContain("incidents");
    expect(tablesSeen).not.toContain("alert_deliveries");
  });

  it("continues processing when one monitor fails unexpectedly", async () => {
    const admin = createAdminClient();
    const lockedMonitorOne = createMonitor({ id: "monitor-1" });
    const lockedMonitorTwo = createMonitor({ id: "monitor-2", slug: "m2" });
    const persistScheduledMonitorExecutionResultImpl = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          id: "result-fallback",
          status: "error",
          triggerSource: "scheduled",
          checkedAt: "2026-06-01T00:00:00Z",
          durationMs: 0,
          httpStatus: null,
          errorCode: "RUNNER_EXECUTION_FAILED",
          errorSummary: null,
          responseSummary: null,
          assertionSummary: null,
          metadataSummary: null,
        },
        duplicate: false,
      })
      .mockResolvedValueOnce({
        result: {
          id: "result-success",
          status: "success",
          triggerSource: "scheduled",
          checkedAt: "2026-06-01T00:00:10Z",
          durationMs: 10000,
          httpStatus: 200,
          errorCode: null,
          errorSummary: null,
          responseSummary: null,
          assertionSummary: null,
          metadataSummary: null,
        },
        duplicate: false,
      });
    const releaseMonitorLockImpl = vi.fn().mockResolvedValue(undefined);

    const summary = await runScheduledMonitorRunner(
      { batchSize: 10 },
      {
        now: new Date("2026-06-01T00:00:00Z"),
        selectDueMonitorCandidatesImpl: vi.fn().mockResolvedValue([
          lockedMonitorOne,
          lockedMonitorTwo,
        ]),
        acquireMonitorLockImpl: vi
          .fn()
          .mockResolvedValueOnce(lockedMonitorOne)
          .mockResolvedValueOnce(lockedMonitorTwo),
        evaluateMonitorImpl: vi
          .fn()
          .mockRejectedValueOnce(new Error("boom"))
          .mockResolvedValueOnce(createExecutionResult()),
        persistScheduledMonitorExecutionResultImpl,
        releaseMonitorLockImpl,
      },
      admin.client as never,
    );

    expect(summary).toMatchObject<Partial<MonitorRunnerSummary>>({
      dueCount: 2,
      executedCount: 2,
      failedCount: 1,
    });
    expect(persistScheduledMonitorExecutionResultImpl).toHaveBeenCalledTimes(2);
    expect(releaseMonitorLockImpl).toHaveBeenCalledTimes(2);
  });

  it("reuses the shared result persistence path with scheduled metadata", async () => {
    const admin = createAdminClient();
    const lockedMonitor = createMonitor();
    const persistScheduledMonitorExecutionResultImpl = vi.fn().mockResolvedValue({
      result: {
        id: "result-1",
        status: "success",
        triggerSource: "scheduled",
        checkedAt: "2026-06-01T00:00:10Z",
        durationMs: 10000,
        httpStatus: 200,
        errorCode: null,
        errorSummary: null,
        responseSummary: null,
        assertionSummary: null,
        metadataSummary: null,
      },
      duplicate: false,
    });
    const releaseMonitorLockImpl = vi.fn().mockResolvedValue(undefined);

    await runScheduledMonitorRunner(
      {},
      {
        now: new Date("2026-06-01T00:00:00Z"),
        selectDueMonitorCandidatesImpl: vi.fn().mockResolvedValue([lockedMonitor]),
        acquireMonitorLockImpl: vi.fn().mockResolvedValue(lockedMonitor),
        evaluateMonitorImpl: vi.fn().mockResolvedValue(createExecutionResult()),
        persistScheduledMonitorExecutionResultImpl,
        releaseMonitorLockImpl,
      },
      admin.client as never,
    );

    expect(persistScheduledMonitorExecutionResultImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        monitor: lockedMonitor,
      }),
      expect.objectContaining({
        runnerRunId: "run-1",
        suppressedByMaintenanceWindowId: null,
        idempotencyKey: "org-1:monitor-1:2026-06-01T00:00:00Z",
      }),
      admin.client,
    );
    expect(releaseMonitorLockImpl).toHaveBeenCalledWith(
      "monitor-1",
      "org-1",
      "run-1",
      expect.objectContaining({
        next_check_at: "2026-06-01T00:05:00.000Z",
        status: "operational",
      }),
      admin.client,
    );
  });

  it("uses the persisted duplicate result when a scheduled idempotency key is reused", async () => {
    const admin = createAdminClient();
    const lockedMonitor = createMonitor({
      status: "operational",
      consecutiveFailures: 2,
      consecutiveFailureThreshold: 3,
    });
    const persistScheduledMonitorExecutionResultImpl = vi.fn().mockResolvedValue({
      result: {
        id: "result-duplicate",
        status: "failure",
        triggerSource: "scheduled",
        checkedAt: "2026-06-01T00:00:10Z",
        durationMs: 10000,
        httpStatus: 503,
        errorCode: "HTTP_503",
        errorSummary: "The endpoint responded with HTTP 503.",
        responseSummary: null,
        assertionSummary: null,
        metadataSummary: null,
      },
      duplicate: true,
    });
    const releaseMonitorLockImpl = vi.fn().mockResolvedValue(undefined);

    await runScheduledMonitorRunner(
      {},
      {
        now: new Date("2026-06-01T00:00:00Z"),
        selectDueMonitorCandidatesImpl: vi.fn().mockResolvedValue([lockedMonitor]),
        acquireMonitorLockImpl: vi.fn().mockResolvedValue(lockedMonitor),
        evaluateMonitorImpl: vi.fn().mockResolvedValue(createExecutionResult()),
        persistScheduledMonitorExecutionResultImpl,
        releaseMonitorLockImpl,
      },
      admin.client as never,
    );

    expect(releaseMonitorLockImpl).toHaveBeenCalledWith(
      "monitor-1",
      "org-1",
      "run-1",
      expect.objectContaining({
        consecutive_failures: 3,
        status: "down",
      }),
      admin.client,
    );
  });

  it("counts duplicate scheduled results from the persisted outcome, not the replayed execution", async () => {
    const admin = createAdminClient();
    const lockedMonitor = createMonitor();

    const summary = await runScheduledMonitorRunner(
      {},
      {
        now: new Date("2026-06-01T00:00:00Z"),
        selectDueMonitorCandidatesImpl: vi.fn().mockResolvedValue([lockedMonitor]),
        acquireMonitorLockImpl: vi.fn().mockResolvedValue(lockedMonitor),
        evaluateMonitorImpl: vi.fn().mockResolvedValue(
          createExecutionResult({ status: "failure", errorCode: "HTTP_503" }),
        ),
        persistScheduledMonitorExecutionResultImpl: vi.fn().mockResolvedValue({
          result: {
            id: "result-duplicate-success",
            status: "success",
            triggerSource: "scheduled",
            checkedAt: "2026-06-01T00:00:10Z",
            durationMs: 10000,
            httpStatus: 200,
            errorCode: null,
            errorSummary: null,
            responseSummary: null,
            assertionSummary: null,
            metadataSummary: null,
          },
          duplicate: true,
        }),
        releaseMonitorLockImpl: vi.fn().mockResolvedValue(undefined),
      },
      admin.client as never,
    );

    expect(summary).toMatchObject<Partial<MonitorRunnerSummary>>({
      executedCount: 1,
      failedCount: 0,
    });
  });
});
