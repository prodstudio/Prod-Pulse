import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cron alert runner route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/server/alerts/alert-engine");
    delete process.env.CRON_SECRET;
    delete process.env.ALERT_RUNNER_ENABLED;
    delete process.env.SLACK_ALERTS_ENABLED;
  });

  it("rejects requests without the cron secret", async () => {
    process.env.CRON_SECRET = "top-secret";
    process.env.ALERT_RUNNER_ENABLED = "true";
    process.env.SLACK_ALERTS_ENABLED = "true";

    vi.doMock("@/lib/server/alerts/alert-engine", () => ({
      runAlertDeliveryRunner: vi.fn(),
    }));

    const { POST } = await import("@/app/api/cron/alert-runner/route");
    const response = await POST(
      new Request("https://example.com/api/cron/alert-runner", {
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication required.",
      },
    });
  });

  it("skips when the alert runner is disabled", async () => {
    process.env.CRON_SECRET = "top-secret";
    process.env.ALERT_RUNNER_ENABLED = "false";
    process.env.SLACK_ALERTS_ENABLED = "true";
    const runAlertDeliveryRunner = vi.fn();

    vi.doMock("@/lib/server/alerts/alert-engine", () => ({
      runAlertDeliveryRunner,
    }));

    const { POST } = await import("@/app/api/cron/alert-runner/route");
    const response = await POST(
      new Request("https://example.com/api/cron/alert-runner", {
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
    expect(runAlertDeliveryRunner).not.toHaveBeenCalled();
  });

  it("skips when Slack alerts are disabled", async () => {
    process.env.CRON_SECRET = "top-secret";
    process.env.ALERT_RUNNER_ENABLED = "true";
    process.env.SLACK_ALERTS_ENABLED = "false";
    const runAlertDeliveryRunner = vi.fn();

    vi.doMock("@/lib/server/alerts/alert-engine", () => ({
      runAlertDeliveryRunner,
    }));

    const { POST } = await import("@/app/api/cron/alert-runner/route");
    const response = await POST(
      new Request("https://example.com/api/cron/alert-runner", {
        method: "POST",
        headers: {
          authorization: "Bearer top-secret",
        },
      }),
    );
    const body = await response.json();

    expect(body).toEqual({
      data: {
        status: "skipped",
        reason: "slack_disabled",
      },
    });
    expect(runAlertDeliveryRunner).not.toHaveBeenCalled();
  });

  it("returns the safe runner summary for authorized requests", async () => {
    process.env.CRON_SECRET = "top-secret";
    process.env.ALERT_RUNNER_ENABLED = "true";
    process.env.SLACK_ALERTS_ENABLED = "true";
    const runAlertDeliveryRunner = vi.fn().mockResolvedValue({
      runId: "run-1",
      selectedCount: 3,
      sentCount: 2,
      failedCount: 1,
      skippedCount: 0,
      durationMs: 1200,
    });

    vi.doMock("@/lib/server/alerts/alert-engine", () => ({
      runAlertDeliveryRunner,
    }));

    const { POST } = await import("@/app/api/cron/alert-runner/route");
    const response = await POST(
      new Request("https://example.com/api/cron/alert-runner", {
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
        selectedCount: 3,
        sentCount: 2,
        failedCount: 1,
        skippedCount: 0,
        durationMs: 1200,
      },
    });
  });
});
