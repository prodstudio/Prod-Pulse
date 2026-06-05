import { describe, expect, it, vi } from "vitest";

import { acquireMonitorLock, selectDueMonitorCandidates } from "@/lib/server/monitoring/runner-locks";

function createSelectChain(result: { data?: unknown; error?: { message: string; code?: string } }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: result.data ?? null,
      error: result.error ?? null,
    }),
  };
}

function createUpdateChain(result: { data?: unknown; error?: { message: string; code?: string } }) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: result.data ?? null,
      error: result.error ?? null,
    }),
  };
}

function createFetchChain(result: { data?: unknown; error?: { message: string; code?: string } }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: result.data ?? null,
      error: result.error ?? null,
    }),
  };
}

const rawMonitorRow = {
  id: "monitor-1",
  organization_id: "org-1",
  app_id: "app-1",
  environment_id: "env-1",
  name: "Health",
  slug: "health",
  type: "http_uptime",
  status: "unknown",
  is_enabled: true,
  request_method: "GET",
  target_url: "https://example.com/health",
  expected_status_codes: [200],
  interval_seconds: 300,
  next_check_at: "2026-06-01T00:00:00Z",
  timeout_ms: 10000,
  latency_threshold_ms: null,
  consecutive_failure_threshold: 3,
  consecutive_recovery_threshold: 2,
  consecutive_failures: 0,
  consecutive_successes: 0,
  configuration: {},
  description: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  last_checked_at: null,
  last_success_at: null,
  last_failure_at: null,
  last_scheduled_bucket: null,
  locked_at: null,
  lock_expires_at: null,
  locked_by_run_id: null,
};

describe("runner locks", () => {
  it("selects only due candidates with the stale-lock filter applied", async () => {
    const chain = createSelectChain({ data: [rawMonitorRow] });
    const adminClient = {
      from: vi.fn(() => chain),
    };

    const monitors = await selectDueMonitorCandidates(
      new Date("2026-06-01T00:00:00Z"),
      10,
      adminClient as never,
    );

    expect(monitors).toHaveLength(1);
    expect(chain.lte).toHaveBeenCalledWith("next_check_at", "2026-06-01T00:00:00.000Z");
    expect(chain.or).toHaveBeenCalledWith(
      "lock_expires_at.is.null,lock_expires_at.lt.2026-06-01T00:00:00.000Z",
    );
  });

  it("can reclaim a stale lock when acquiring a monitor", async () => {
    const chain = createUpdateChain({
      data: {
        ...rawMonitorRow,
        lock_expires_at: "2026-05-31T23:59:00Z",
        locked_by_run_id: "old-run",
      },
    });
    const adminClient = {
      from: vi.fn(() => chain),
    };

    const monitor = await acquireMonitorLock(
      "monitor-1",
      "org-1",
      "run-1",
      new Date("2026-06-01T00:00:00Z"),
      60_000,
      adminClient as never,
    );

    expect(monitor?.id).toBe("monitor-1");
    expect(chain.or).toHaveBeenCalledWith(
      "lock_expires_at.is.null,lock_expires_at.lt.2026-06-01T00:00:00.000Z",
    );
  });

  it("fetches the monitor locked by this run when the update select returns no row", async () => {
    const updateChain = createUpdateChain({ data: null });
    const fetchChain = createFetchChain({
      data: {
        ...rawMonitorRow,
        locked_by_run_id: "run-1",
      },
    });
    const adminClient = {
      from: vi
        .fn()
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(fetchChain),
    };

    const monitor = await acquireMonitorLock(
      "monitor-1",
      "org-1",
      "run-1",
      new Date("2026-06-01T00:00:00Z"),
      60_000,
      adminClient as never,
    );

    expect(monitor?.id).toBe("monitor-1");
    expect(fetchChain.eq).toHaveBeenCalledWith("locked_by_run_id", "run-1");
  });
});
