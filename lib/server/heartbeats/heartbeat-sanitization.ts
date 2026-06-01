import "server-only";

import { sanitizeIncidentText } from "@/lib/server/incidents/incident-sanitization";

type HeartbeatPayloadStatus = "ok" | "degraded" | "down";

export type RawHeartbeatRecord = {
  id: string;
  organizationId: string;
  appId: string;
  environmentId: string | null;
  monitorId: string | null;
  name: string;
  slug: string;
  expectedIntervalSeconds: number;
  graceSeconds: number;
  tokenHash: string;
  tokenHint: string | null;
  isEnabled: boolean;
  status: string;
  lastSeenAt: string | null;
  lastPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SafeHeartbeatSummary = {
  id: string;
  appId: string;
  environmentId: string | null;
  monitorId: string | null;
  name: string;
  slug: string;
  expectedIntervalSeconds: number;
  graceSeconds: number;
  isEnabled: boolean;
  status: string;
  lastSeenAt: string | null;
  tokenHint: string | null;
  payloadSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SafeHeartbeatDetail = SafeHeartbeatSummary;

export type HeartbeatPingPayload = {
  service?: string;
  environment?: string;
  jobName?: string;
  runId?: string;
  status?: HeartbeatPayloadStatus;
  message?: string;
  durationMs?: number;
  timestamp?: string;
};

export type SanitizedHeartbeatPayload = {
  service: string | null;
  environment: string | null;
  jobName: string | null;
  runId: string | null;
  status: HeartbeatPayloadStatus;
  message: string | null;
  durationMs: number | null;
  reportedTimestamp: string | null;
};

function sanitizeLabel(value: string | undefined, maxLength = 120) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/[^\P{C}\n\t]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  const strippedSecrets = normalized
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?|amqp|amqps):\/\/[^\s]+/gi, "[redacted-connection]")
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, "Bearer [redacted]");

  return strippedSecrets.length <= maxLength
    ? strippedSecrets
    : `${strippedSecrets.slice(0, maxLength - 1)}…`;
}

function sanitizeRunId(value: string | undefined) {
  const normalized = sanitizeLabel(value, 160);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/[^A-Za-z0-9._:@/-]/g, "-");
}

function sanitizeDuration(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value < 0 || value > 86_400_000) {
    return null;
  }

  return Math.round(value);
}

function sanitizeReportedTimestamp(value: string | undefined) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function sanitizeHeartbeatPayload(
  payload: HeartbeatPingPayload | null | undefined,
): SanitizedHeartbeatPayload {
  const input = payload ?? {};

  return {
    service: sanitizeLabel(input.service, 100),
    environment: sanitizeLabel(input.environment, 100),
    jobName: sanitizeLabel(input.jobName, 140),
    runId: sanitizeRunId(input.runId),
    status:
      input.status === "degraded" || input.status === "down" ? input.status : "ok",
    message: sanitizeIncidentText(input.message, 280),
    durationMs: sanitizeDuration(input.durationMs),
    reportedTimestamp: sanitizeReportedTimestamp(input.timestamp),
  };
}

function summarizePayload(payload: Record<string, unknown>) {
  const status = typeof payload.status === "string" ? payload.status : null;
  const jobName = typeof payload.jobName === "string" ? payload.jobName : null;
  const service = typeof payload.service === "string" ? payload.service : null;
  const message = typeof payload.message === "string" ? payload.message : null;

  const parts = [status, jobName ?? service, message].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" · ");
}

export function toSafeHeartbeatSummary(rawHeartbeat: RawHeartbeatRecord): SafeHeartbeatSummary {
  return {
    id: rawHeartbeat.id,
    appId: rawHeartbeat.appId,
    environmentId: rawHeartbeat.environmentId,
    monitorId: rawHeartbeat.monitorId,
    name: rawHeartbeat.name,
    slug: rawHeartbeat.slug,
    expectedIntervalSeconds: rawHeartbeat.expectedIntervalSeconds,
    graceSeconds: rawHeartbeat.graceSeconds,
    isEnabled: rawHeartbeat.isEnabled,
    status: rawHeartbeat.status,
    lastSeenAt: rawHeartbeat.lastSeenAt,
    tokenHint: rawHeartbeat.tokenHint,
    payloadSummary: summarizePayload(rawHeartbeat.lastPayload),
    createdAt: rawHeartbeat.createdAt,
    updatedAt: rawHeartbeat.updatedAt,
  };
}

export function toSafeHeartbeatDetail(rawHeartbeat: RawHeartbeatRecord): SafeHeartbeatDetail {
  return toSafeHeartbeatSummary(rawHeartbeat);
}

export function sanitizeHeartbeatForAudit(rawHeartbeat: RawHeartbeatRecord) {
  const safeHeartbeat = toSafeHeartbeatSummary(rawHeartbeat);

  return {
    id: safeHeartbeat.id,
    appId: safeHeartbeat.appId,
    environmentId: safeHeartbeat.environmentId,
    monitorId: safeHeartbeat.monitorId,
    name: safeHeartbeat.name,
    slug: safeHeartbeat.slug,
    expectedIntervalSeconds: safeHeartbeat.expectedIntervalSeconds,
    graceSeconds: safeHeartbeat.graceSeconds,
    isEnabled: safeHeartbeat.isEnabled,
    status: safeHeartbeat.status,
    lastSeenAt: safeHeartbeat.lastSeenAt,
    tokenHint: safeHeartbeat.tokenHint,
    payloadSummary: safeHeartbeat.payloadSummary,
    updatedAt: safeHeartbeat.updatedAt,
  };
}
