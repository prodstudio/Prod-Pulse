import "server-only";

import type { SafeMonitorResult } from "@/lib/server/monitoring/result-sanitization";

const MAX_TEXT_LENGTH = 4000;
const MAX_TITLE_LENGTH = 160;

type IncidentStatus =
  | "detected"
  | "open"
  | "acknowledged"
  | "investigating"
  | "monitoring"
  | "resolved";

type IncidentSeverity = "info" | "warning" | "critical" | "emergency";

export type IncidentRelations = {
  appName: string | null;
  appSlug: string | null;
  monitorName: string | null;
  monitorSlug: string | null;
  environmentName: string | null;
};

export type RawIncidentRecord = {
  id: string;
  organizationId: string;
  appId: string;
  environmentId: string | null;
  monitorId: string;
  createdFromResultId: string | null;
  title: string;
  summary: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  dedupeKey: string;
  assignedTo: string | null;
  openedBy: string | null;
  detectedAt: string;
  openedAt: string | null;
  acknowledgedAt: string | null;
  recoveredAt: string | null;
  resolvedAt: string | null;
  autoResolveOnRecovery: boolean;
  rootCause: string | null;
  resolutionNotes: string | null;
  lastStateChangeAt: string;
  createdAt: string;
  updatedAt: string;
};

export type SafeIncidentUpdate = {
  id: string;
  actorType: "user" | "system" | "heartbeat";
  actorUserId: string | null;
  statusFrom: IncidentStatus | null;
  statusTo: IncidentStatus | null;
  message: string | null;
  createdAt: string;
};

export type SafeIncidentSummary = {
  id: string;
  appId: string;
  environmentId: string | null;
  monitorId: string;
  title: string;
  summary: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  appName: string | null;
  appSlug: string | null;
  monitorName: string | null;
  monitorSlug: string | null;
  environmentName: string | null;
  detectedAt: string;
  openedAt: string | null;
  acknowledgedAt: string | null;
  recoveredAt: string | null;
  resolvedAt: string | null;
  lastStateChangeAt: string;
  createdAt: string;
  updatedAt: string;
  durationSeconds: number | null;
};

export type SafeIncidentDetail = SafeIncidentSummary & {
  autoResolveOnRecovery: boolean;
  rootCause: string | null;
  resolutionNotes: string | null;
  createdFromResultId: string | null;
  assignedTo: string | null;
  updates: SafeIncidentUpdate[];
  latestResults: SafeMonitorResult[];
};

function redactSecrets(input: string) {
  return input
    .replace(/https?:\/\/hooks\.slack\.com\/services\/[^\s"']+/gi, "[redacted-webhook-url]")
    .replace(/\b(?:postgres(?:ql)?|mysql|mariadb|redis|rediss|mongodb(?:\+srv)?|amqp|amqps):\/\/[^\s"']+/gi, "[redacted-connection-url]")
    .replace(/\bAuthorization\s*[:=]\s*Bearer\s+[^\s,;]+/gi, "Authorization=[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, "Bearer [redacted]")
    .replace(/\b(authorization|cookie|token|secret|password|webhook(?:Url)?|databaseUrl|database_url)\b\s*[:=]\s*([^\s,;]+)/gi, "$1=[redacted]");
}

export function sanitizeIncidentText(value: string | null | undefined, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n\t]+/g, " ")
    .replace(/[^\P{C}\n\t]/gu, "")
    .trim();

  if (!normalized) {
    return null;
  }

  const redacted = redactSecrets(normalized);

  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}

export function sanitizeIncidentTitle(value: string) {
  return sanitizeIncidentText(value, MAX_TITLE_LENGTH) ?? "Incident";
}

export function toSafeIncidentUpdate(row: {
  id: string;
  actor_type: string;
  actor_user_id: string | null;
  status_from: IncidentStatus | null;
  status_to: IncidentStatus | null;
  message: string | null;
  created_at: string;
}): SafeIncidentUpdate {
  return {
    id: row.id,
    actorType: row.actor_type as SafeIncidentUpdate["actorType"],
    actorUserId: row.actor_user_id,
    statusFrom: row.status_from,
    statusTo: row.status_to,
    message: sanitizeIncidentText(row.message),
    createdAt: row.created_at,
  };
}

function toDurationSeconds(raw: RawIncidentRecord) {
  const endTime = raw.resolvedAt ?? new Date().toISOString();
  const durationMs = new Date(endTime).getTime() - new Date(raw.detectedAt).getTime();

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }

  return Math.floor(durationMs / 1000);
}

export function toSafeIncidentSummary(
  raw: RawIncidentRecord,
  relations: IncidentRelations,
): SafeIncidentSummary {
  return {
    id: raw.id,
    appId: raw.appId,
    environmentId: raw.environmentId,
    monitorId: raw.monitorId,
    title: sanitizeIncidentTitle(raw.title),
    summary: sanitizeIncidentText(raw.summary),
    severity: raw.severity,
    status: raw.status,
    appName: relations.appName,
    appSlug: relations.appSlug,
    monitorName: relations.monitorName,
    monitorSlug: relations.monitorSlug,
    environmentName: relations.environmentName,
    detectedAt: raw.detectedAt,
    openedAt: raw.openedAt,
    acknowledgedAt: raw.acknowledgedAt,
    recoveredAt: raw.recoveredAt,
    resolvedAt: raw.resolvedAt,
    lastStateChangeAt: raw.lastStateChangeAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    durationSeconds: toDurationSeconds(raw),
  };
}

export function toSafeIncidentDetail(
  raw: RawIncidentRecord,
  relations: IncidentRelations,
  updates: SafeIncidentUpdate[],
  latestResults: SafeMonitorResult[],
): SafeIncidentDetail {
  return {
    ...toSafeIncidentSummary(raw, relations),
    autoResolveOnRecovery: raw.autoResolveOnRecovery,
    rootCause: sanitizeIncidentText(raw.rootCause),
    resolutionNotes: sanitizeIncidentText(raw.resolutionNotes),
    createdFromResultId: raw.createdFromResultId,
    assignedTo: raw.assignedTo,
    updates,
    latestResults,
  };
}

export function sanitizeIncidentForAudit(raw: RawIncidentRecord) {
  return {
    id: raw.id,
    appId: raw.appId,
    environmentId: raw.environmentId,
    monitorId: raw.monitorId,
    title: sanitizeIncidentTitle(raw.title),
    summary: sanitizeIncidentText(raw.summary),
    severity: raw.severity,
    status: raw.status,
    dedupeKey: raw.dedupeKey,
    detectedAt: raw.detectedAt,
    openedAt: raw.openedAt,
    acknowledgedAt: raw.acknowledgedAt,
    recoveredAt: raw.recoveredAt,
    resolvedAt: raw.resolvedAt,
    autoResolveOnRecovery: raw.autoResolveOnRecovery,
    rootCause: sanitizeIncidentText(raw.rootCause),
    resolutionNotes: sanitizeIncidentText(raw.resolutionNotes),
    lastStateChangeAt: raw.lastStateChangeAt,
    updatedAt: raw.updatedAt,
  };
}
