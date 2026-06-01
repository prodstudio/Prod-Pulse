import "server-only";

import { ApiError } from "@/lib/server/api/errors";

function getBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function isMonitorRunnerEnabled() {
  return process.env.MONITOR_RUNNER_ENABLED === "true";
}

export function isAlertRunnerEnabled() {
  return process.env.ALERT_RUNNER_ENABLED === "true";
}

export function isSlackAlertsEnabled() {
  return process.env.SLACK_ALERTS_ENABLED === "true";
}

export function requireInternalJob(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  const providedSecret =
    getBearerToken(request.headers.get("authorization")) ??
    request.headers.get("x-cron-secret");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    throw new ApiError(401, "unauthorized", "Authentication required.");
  }
}
