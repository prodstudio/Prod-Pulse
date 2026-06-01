import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "@/lib/server/api/errors";
import {
  isAlertRunnerEnabled,
  isMonitorRunnerEnabled,
  isSlackAlertsEnabled,
  requireInternalJob,
} from "@/lib/server/jobs/require-internal-job";

describe("requireInternalJob", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.MONITOR_RUNNER_ENABLED;
    delete process.env.ALERT_RUNNER_ENABLED;
    delete process.env.SLACK_ALERTS_ENABLED;
  });

  it("accepts a valid bearer token", () => {
    process.env.CRON_SECRET = "top-secret";

    expect(() =>
      requireInternalJob(
        new Request("https://example.com/api/cron/monitor-runner", {
          method: "POST",
          headers: {
            authorization: "Bearer top-secret",
          },
        }),
      ),
    ).not.toThrow();
  });

  it("rejects missing or invalid secrets with an auth-safe error", () => {
    process.env.CRON_SECRET = "top-secret";

    expect(() =>
      requireInternalJob(
        new Request("https://example.com/api/cron/monitor-runner", {
          method: "POST",
        }),
      ),
    ).toThrow(ApiError);
  });

  it("reads the runner enabled flag strictly", () => {
    process.env.MONITOR_RUNNER_ENABLED = "true";
    expect(isMonitorRunnerEnabled()).toBe(true);

    process.env.MONITOR_RUNNER_ENABLED = "false";
    expect(isMonitorRunnerEnabled()).toBe(false);
  });

  it("reads alert-specific feature flags strictly", () => {
    process.env.ALERT_RUNNER_ENABLED = "true";
    process.env.SLACK_ALERTS_ENABLED = "true";
    expect(isAlertRunnerEnabled()).toBe(true);
    expect(isSlackAlertsEnabled()).toBe(true);

    process.env.ALERT_RUNNER_ENABLED = "false";
    process.env.SLACK_ALERTS_ENABLED = "false";
    expect(isAlertRunnerEnabled()).toBe(false);
    expect(isSlackAlertsEnabled()).toBe(false);
  });
});
