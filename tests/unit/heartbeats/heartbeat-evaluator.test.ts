import { describe, expect, it } from "vitest";

import { evaluateHeartbeatFreshness } from "@/lib/server/heartbeats/heartbeat-evaluator";
import type { RawHeartbeatRecord } from "@/lib/server/heartbeats/heartbeat-sanitization";
import type { RawMonitorRecord } from "@/lib/server/monitors/monitor-sanitization";

function createMonitor(): RawMonitorRecord {
  return {
    id: "monitor-1",
    organizationId: "org-1",
    appId: "app-1",
    environmentId: "env-1",
    name: "Nightly sync heartbeat",
    slug: "nightly-sync-heartbeat",
    type: "heartbeat",
    status: "unknown",
    isEnabled: true,
    requestMethod: "GET",
    targetUrl: null,
    expectedStatusCodes: [200],
    intervalSeconds: 300,
    nextCheckAt: "2026-06-01T03:00:00Z",
    timeoutMs: 10000,
    latencyThresholdMs: null,
    consecutiveFailureThreshold: 3,
    consecutiveRecoveryThreshold: 2,
    configuration: {},
    description: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  };
}

function createHeartbeat(overrides: Partial<RawHeartbeatRecord> = {}): RawHeartbeatRecord {
  return {
    id: "heartbeat-1",
    organizationId: "org-1",
    appId: "app-1",
    environmentId: "env-1",
    monitorId: "monitor-1",
    name: "Nightly sync",
    slug: "nightly-sync",
    expectedIntervalSeconds: 300,
    graceSeconds: 120,
    tokenHash: "hashed",
    tokenHint: "...secret",
    isEnabled: true,
    status: "operational",
    lastSeenAt: "2026-06-01T03:03:00Z",
    lastPayload: {
      status: "ok",
      jobName: "nightly-sync",
    },
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T03:03:00Z",
    ...overrides,
  };
}

describe("heartbeat evaluator", () => {
  it("creates a success result for fresh heartbeats", () => {
    const result = evaluateHeartbeatFreshness({
      monitor: createMonitor(),
      heartbeat: createHeartbeat(),
      now: new Date("2026-06-01T03:05:00Z"),
    });

    expect(result.status).toBe("success");
    expect(result.errorCode).toBeNull();
  });

  it("creates a failure result for stale heartbeats", () => {
    const result = evaluateHeartbeatFreshness({
      monitor: createMonitor(),
      heartbeat: createHeartbeat({
        lastSeenAt: "2026-06-01T02:50:00Z",
      }),
      now: new Date("2026-06-01T03:10:00Z"),
    });

    expect(result.status).toBe("failure");
    expect(result.errorCode).toBe("HEARTBEAT_STALE");
  });
});
