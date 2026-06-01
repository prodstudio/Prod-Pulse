import "server-only";

import type { MonitorExecutionResult } from "@/lib/server/monitoring/evaluate";
import type { RawMonitorRecord } from "@/lib/server/monitors/monitor-sanitization";
import type { RawHeartbeatRecord } from "@/lib/server/heartbeats/heartbeat-sanitization";

type HeartbeatEvaluationInput = {
  monitor: RawMonitorRecord;
  heartbeat: RawHeartbeatRecord | null;
  now?: Date;
};

function buildExecutionResult(
  checkedAt: string,
  result: Omit<MonitorExecutionResult, "checkedAt" | "startedAt" | "finishedAt">,
): MonitorExecutionResult {
  return {
    checkedAt,
    startedAt: checkedAt,
    finishedAt: checkedAt,
    ...result,
  };
}

export function evaluateHeartbeatFreshness({
  monitor,
  heartbeat,
  now = new Date(),
}: HeartbeatEvaluationInput): MonitorExecutionResult {
  const checkedAt = now.toISOString();

  if (!heartbeat) {
    return buildExecutionResult(checkedAt, {
      status: "error",
      durationMs: 0,
      httpStatus: null,
      errorCode: "HEARTBEAT_NOT_CONFIGURED",
      errorMessage: "No heartbeat is linked to this monitor.",
      responseExcerpt: null,
      assertionResults: {},
      metadata: {
        note: "Heartbeat monitor is missing a linked heartbeat definition.",
      },
      attempts: [],
    });
  }

  if (!heartbeat.isEnabled) {
    return buildExecutionResult(checkedAt, {
      status: "skipped",
      durationMs: 0,
      httpStatus: null,
      errorCode: "HEARTBEAT_DISABLED",
      errorMessage: "Heartbeat ingestion is disabled for this monitor.",
      responseExcerpt: null,
      assertionResults: {},
      metadata: {
        note: "Heartbeat is disabled and was skipped during freshness evaluation.",
      },
      attempts: [],
    });
  }

  if (!heartbeat.lastSeenAt) {
    return buildExecutionResult(checkedAt, {
      status: "failure",
      durationMs: 0,
      httpStatus: null,
      errorCode: "HEARTBEAT_NEVER_SEEN",
      errorMessage: "No heartbeat ping has been recorded yet.",
      responseExcerpt: null,
      assertionResults: {},
      metadata: {
        expectedIntervalSeconds: heartbeat.expectedIntervalSeconds,
        graceSeconds: heartbeat.graceSeconds,
        heartbeatName: heartbeat.name,
      },
      attempts: [],
    });
  }

  const lastSeenAt = new Date(heartbeat.lastSeenAt);
  const staleAfterMs =
    (heartbeat.expectedIntervalSeconds + heartbeat.graceSeconds) * 1000;
  const ageMs = now.getTime() - lastSeenAt.getTime();
  const stale = !Number.isFinite(ageMs) || ageMs > staleAfterMs;

  if (stale) {
    return buildExecutionResult(checkedAt, {
      status: "failure",
      durationMs: 0,
      httpStatus: null,
      errorCode: "HEARTBEAT_STALE",
      errorMessage: "The heartbeat has not checked in within the configured freshness window.",
      responseExcerpt: null,
      assertionResults: {},
      metadata: {
        heartbeatName: heartbeat.name,
        lastSeenAt: heartbeat.lastSeenAt,
        ageSeconds: Math.max(Math.floor(ageMs / 1000), 0),
        expectedIntervalSeconds: heartbeat.expectedIntervalSeconds,
        graceSeconds: heartbeat.graceSeconds,
        payloadStatus:
          typeof heartbeat.lastPayload.status === "string" ? heartbeat.lastPayload.status : null,
      },
      attempts: [],
    });
  }

  const payloadStatus =
    typeof heartbeat.lastPayload.status === "string" ? heartbeat.lastPayload.status : "ok";
  const status =
    payloadStatus === "down"
      ? "failure"
      : payloadStatus === "degraded"
        ? "degraded"
        : "success";

  return buildExecutionResult(checkedAt, {
    status,
    durationMs: 0,
    httpStatus: null,
    errorCode: status === "failure" ? "HEARTBEAT_REPORTED_DOWN" : null,
    errorMessage:
      status === "failure" ? "The latest heartbeat reported a down status." : null,
    responseExcerpt: null,
    assertionResults: {},
    metadata: {
      heartbeatName: heartbeat.name,
      lastSeenAt: heartbeat.lastSeenAt,
      expectedIntervalSeconds: heartbeat.expectedIntervalSeconds,
      graceSeconds: heartbeat.graceSeconds,
      payloadStatus,
      monitorName: monitor.name,
    },
    attempts: [],
  });
}
