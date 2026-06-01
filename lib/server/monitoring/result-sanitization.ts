import "server-only";

const MAX_EXCERPT_LENGTH = 280;
const MAX_ERROR_LENGTH = 200;

export type SafeMonitorResult = {
  id: string;
  status: string;
  triggerSource: string;
  checkedAt: string;
  durationMs: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorSummary: string | null;
  responseSummary: string | null;
  assertionSummary: string | null;
  metadataSummary: string | null;
};

type SafeJson =
  | string
  | number
  | boolean
  | null
  | SafeJson[]
  | { [key: string]: SafeJson };

type RawMonitorResultRecord = {
  id: string;
  status: string;
  triggerSource: string;
  checkedAt: string;
  durationMs: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  responseExcerpt: string | null;
  assertionResults: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

function redactSecrets(input: string) {
  return input
    .replace(/https?:\/\/hooks\.slack\.com\/services\/[^\s"']+/gi, "[redacted-webhook-url]")
    .replace(/\b(?:postgres(?:ql)?|mysql|mariadb|redis|rediss|mongodb(?:\+srv)?|amqp|amqps):\/\/[^\s"']+/gi, "[redacted-connection-url]")
    .replace(/\bAuthorization\s*[:=]\s*Bearer\s+[^\s,;]+/gi, "Authorization=[redacted]")
    .replace(
      /"(authorization|cookie|set-cookie|x-api-key|api[_-]?key|token|secret|password|webhook(?:Url)?|databaseUrl|database_url|connection(?:String)?)"\s*:\s*"([^"]*)"/gi,
      '"$1":"[redacted]"',
    )
    .replace(
      /\b(authorization|cookie|set-cookie|x-api-key|api[_-]?key|token|secret|password)\b\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[redacted]",
    )
    .replace(
      /([?&](?:token|api[_-]?key|key|secret|password|signature|sig)=)([^&\s]+)/gi,
      "$1[redacted]",
    )
    .replace(/https?:\/\/([^/\s:@]+):([^@/\s]+)@/gi, "https://[redacted]@")
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g, "[redacted-jwt]")
    .replace(/\b(?:sbp|sb_secret|service_role|anon)_[A-Za-z0-9._-]+\b/gi, "[redacted-token]");
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function normalizeText(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (/<(?:!doctype|html|body|head|script|style)\b/i.test(trimmed)) {
    return "HTML response omitted.";
  }

  if (/\bat\s+.+?:\d+:\d+\b/.test(trimmed) || /(?:error|exception):\s.+\bat\s+/i.test(trimmed)) {
    return "Error response omitted.";
  }

  const collapsed = trimmed.replace(/\s+/g, " ").trim();

  if (!collapsed) {
    return null;
  }

  return truncate(redactSecrets(collapsed), maxLength);
}

function sanitizeUnknown(value: unknown, depth = 0): SafeJson {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return normalizeText(value, MAX_EXCERPT_LENGTH) ?? null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (depth >= 3) {
    return "[truncated]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeUnknown(item, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20);
    const safeObject: Record<string, SafeJson> = {};

    for (const [key, entry] of entries) {
      if (
        /authorization|cookie|token|secret|password|apikey|api_key|webhook|database(?:_?url)?|connection/i.test(
          key,
        )
      ) {
        safeObject[key] = "[redacted]";
        continue;
      }

      safeObject[key] = sanitizeUnknown(entry, depth + 1);
    }

    return safeObject;
  }

  return String(value);
}

export function sanitizeStoredResponseExcerpt(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return normalizeText(value, MAX_EXCERPT_LENGTH);
}

export function sanitizeStoredErrorMessage(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return normalizeText(value, MAX_ERROR_LENGTH);
}

export function sanitizeAssertionResults(
  value: Record<string, unknown> | null | undefined,
): Record<string, SafeJson> {
  if (!value) {
    return {};
  }

  return sanitizeUnknown(value) as Record<string, SafeJson>;
}

export function sanitizeResultMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, SafeJson> {
  if (!value) {
    return {};
  }

  return sanitizeUnknown(value) as Record<string, SafeJson>;
}

function summarizeAssertions(assertionResults: Record<string, unknown>) {
  const results = assertionResults.results;

  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const passedCount = results.filter(
    (result) => result && typeof result === "object" && (result as { passed?: boolean }).passed,
  ).length;

  return `${passedCount}/${results.length} assertions passed`;
}

function summarizeMetadata(metadata: Record<string, unknown>) {
  if (typeof metadata.healthStatus === "string") {
    const missingChecks = Array.isArray(metadata.missingChecks)
      ? metadata.missingChecks.length
      : 0;

    return missingChecks > 0
      ? `Health status ${metadata.healthStatus}; ${missingChecks} required check${missingChecks === 1 ? "" : "s"} missing`
      : `Health status ${metadata.healthStatus}`;
  }

  if (typeof metadata.daysUntilExpiry === "number") {
    return `${metadata.daysUntilExpiry} day${metadata.daysUntilExpiry === 1 ? "" : "s"} until certificate expiry`;
  }

  if (typeof metadata.thresholdStatus === "string") {
    return `Latency threshold ${metadata.thresholdStatus}`;
  }

  if (typeof metadata.heartbeatName === "string") {
    const payloadStatus =
      typeof metadata.payloadStatus === "string" ? metadata.payloadStatus : null;
    const lastSeenAt =
      typeof metadata.lastSeenAt === "string" ? metadata.lastSeenAt : null;

    if (payloadStatus && lastSeenAt) {
      return `Heartbeat ${metadata.heartbeatName} ${payloadStatus}; last seen ${lastSeenAt}`;
    }

    if (payloadStatus) {
      return `Heartbeat ${metadata.heartbeatName} ${payloadStatus}`;
    }

    if (lastSeenAt) {
      return `Heartbeat ${metadata.heartbeatName}; last seen ${lastSeenAt}`;
    }
  }

  if (typeof metadata.note === "string") {
    return sanitizeStoredResponseExcerpt(metadata.note);
  }

  return null;
}

export function toSafeMonitorResult(result: RawMonitorResultRecord): SafeMonitorResult {
  return {
    id: result.id,
    status: result.status,
    triggerSource: result.triggerSource,
    checkedAt: result.checkedAt,
    durationMs: result.durationMs,
    httpStatus: result.httpStatus,
    errorCode: result.errorCode,
    errorSummary: sanitizeStoredErrorMessage(result.errorMessage),
    responseSummary: sanitizeStoredResponseExcerpt(result.responseExcerpt),
    assertionSummary: summarizeAssertions(result.assertionResults),
    metadataSummary: summarizeMetadata(result.metadata),
  };
}
