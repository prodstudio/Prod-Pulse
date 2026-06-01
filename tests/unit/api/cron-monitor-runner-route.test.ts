import { afterEach, describe, expect, it, vi } from "vitest";

describe("cron monitor runner route", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.MONITOR_RUNNER_ENABLED;
  });

  it("rejects requests without the cron secret", async () => {
    process.env.CRON_SECRET = "top-secret";
    process.env.MONITOR_RUNNER_ENABLED = "true";

    vi.doMock("@/lib/server/monitoring/runner-service", () => ({
      runScheduledMonitorRunner: vi.fn(),
    }));

    const { POST } = await import("@/app/api/cron/monitor-runner/route");
    const response = await POST(new Request("https://example.com/api/cron/monitor-runner", {
      method: "POST",
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication required.",
      },
    });
  });

  it("returns a skipped response when the runner is disabled", async () => {
    process.env.CRON_SECRET = "top-secret";
    process.env.MONITOR_RUNNER_ENABLED = "false";
    const runScheduledMonitorRunner = vi.fn();

    vi.doMock("@/lib/server/monitoring/runner-service", () => ({
      runScheduledMonitorRunner,
    }));

    const { POST } = await import("@/app/api/cron/monitor-runner/route");
    const response = await POST(
      new Request("https://example.com/api/cron/monitor-runner", {
        method: "POST",
        headers: {
          authorization: "Bearer top-secret",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        status: "skipped",
        reason: "runner_disabled",
      },
    });
    expect(runScheduledMonitorRunner).not.toHaveBeenCalled();
  });

  it("returns the safe runner summary for authorized requests", async () => {
    process.env.CRON_SECRET = "top-secret";
    process.env.MONITOR_RUNNER_ENABLED = "true";
    const runScheduledMonitorRunner = vi.fn().mockResolvedValue({
      runId: "run-1",
      dueCount: 2,
      executedCount: 2,
      skippedCount: 0,
      failedCount: 1,
      durationMs: 1200,
    });

    vi.doMock("@/lib/server/monitoring/runner-service", () => ({
      runScheduledMonitorRunner,
    }));

    const { POST } = await import("@/app/api/cron/monitor-runner/route");
    const response = await POST(
      new Request("https://example.com/api/cron/monitor-runner", {
        method: "POST",
        headers: {
          authorization: "Bearer top-secret",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        status: "completed",
        runId: "run-1",
        dueCount: 2,
        executedCount: 2,
        skippedCount: 0,
        failedCount: 1,
        durationMs: 1200,
      },
    });
  });
});
