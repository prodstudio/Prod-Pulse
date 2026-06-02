import "server-only";

const MAX_SOURCE_KIND_LENGTH = 40;
const MAX_EXTERNAL_ID_LENGTH = 160;
const MAX_KEY_LENGTH = 160;
const MAX_TITLE_LENGTH = 160;
const MAX_STATUS_LENGTH = 80;
const MAX_PRIORITY_LENGTH = 80;
const MAX_CUSTOMER_REFERENCE_LENGTH = 160;
const MAX_SUMMARY_LENGTH = 2000;

export type SafeExternalIssue = {
  id: string;
  sourceKind: string;
  externalId: string;
  externalKey: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  sourceUrl: string | null;
  customerReference: string | null;
  summary: string | null;
  linkedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RawExternalIssueRecord = {
  id: string;
  organizationId: string;
  integrationId: string | null;
  sourceKind: string;
  externalId: string;
  externalKey: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  sourceUrl: string | null;
  customerReference: string | null;
  summary: string | null;
  createdBy: string | null;
  firstSeenAt?: string | null;
  lastSyncedAt?: string | null;
  sourceCreatedAt?: string | null;
  sourceUpdatedAt?: string | null;
  relatedAppId?: string | null;
  relatedEnvironmentId?: string | null;
  relatedMonitorId?: string | null;
  createdAt: string;
  updatedAt: string;
  linkedAt?: string | null;
};

function redactSecrets(input: string) {
  return input
    .replace(/https?:\/\/hooks\.slack\.com\/services\/[^\s"']+/gi, "[redacted-webhook-url]")
    .replace(/\b(?:postgres(?:ql)?|mysql|mariadb|redis|rediss|mongodb(?:\+srv)?|amqp|amqps):\/\/[^\s"']+/gi, "[redacted-connection-url]")
    .replace(/\bAuthorization\s*[:=]\s*Bearer\s+[^\s,;]+/gi, "Authorization=[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, "Bearer [redacted]")
    .replace(/\b(authorization|cookie|token|secret|password|webhook(?:Url)?|databaseUrl|database_url)\b\s*[:=]\s*([^\s,;]+)/gi, "$1=[redacted]");
}

function sanitizeText(
  value: string | null | undefined,
  maxLength: number,
  {
    lowercase = false,
    collapseWhitespace = true,
  }: { lowercase?: boolean; collapseWhitespace?: boolean } = {},
) {
  if (typeof value !== "string") {
    return null;
  }

  let normalized = value.replace(/\r\n/g, "\n").replace(/[^\P{C}\n\t]/gu, "").trim();

  if (collapseWhitespace) {
    normalized = normalized.replace(/[^\S\n\t]+/g, " ");
  }

  if (!normalized) {
    return null;
  }

  const redacted = redactSecrets(lowercase ? normalized.toLowerCase() : normalized);

  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}

export function sanitizeExternalIssueSourceKind(value: string | null | undefined) {
  const normalized = sanitizeText(value, MAX_SOURCE_KIND_LENGTH, { lowercase: true });

  if (!normalized) {
    return "manual";
  }

  return normalized.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "manual";
}

export function sanitizeExternalIssueIdentifier(value: string | null | undefined) {
  return sanitizeText(value, MAX_EXTERNAL_ID_LENGTH) ?? "";
}

export function sanitizeExternalIssueKey(value: string | null | undefined) {
  return sanitizeText(value, MAX_KEY_LENGTH);
}

export function sanitizeExternalIssueTitle(value: string | null | undefined) {
  return sanitizeText(value, MAX_TITLE_LENGTH) ?? "External issue";
}

export function sanitizeExternalIssueStatus(value: string | null | undefined) {
  return sanitizeText(value, MAX_STATUS_LENGTH);
}

export function sanitizeExternalIssuePriority(value: string | null | undefined) {
  return sanitizeText(value, MAX_PRIORITY_LENGTH);
}

export function sanitizeExternalIssueCustomerReference(value: string | null | undefined) {
  return sanitizeText(value, MAX_CUSTOMER_REFERENCE_LENGTH);
}

export function sanitizeExternalIssueSummary(value: string | null | undefined) {
  return sanitizeText(value, MAX_SUMMARY_LENGTH);
}

export function sanitizeExternalIssueUrl(value: string | null | undefined) {
  const sanitized = sanitizeText(value, 500, { collapseWhitespace: false });

  if (!sanitized) {
    return null;
  }

  try {
    const parsed = new URL(sanitized);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function toSafeExternalIssue(raw: RawExternalIssueRecord): SafeExternalIssue {
  return {
    id: raw.id,
    sourceKind: sanitizeExternalIssueSourceKind(raw.sourceKind),
    externalId: sanitizeExternalIssueIdentifier(raw.externalId),
    externalKey: sanitizeExternalIssueKey(raw.externalKey),
    title: sanitizeExternalIssueTitle(raw.title),
    status: sanitizeExternalIssueStatus(raw.status),
    priority: sanitizeExternalIssuePriority(raw.priority),
    sourceUrl: sanitizeExternalIssueUrl(raw.sourceUrl),
    customerReference: sanitizeExternalIssueCustomerReference(raw.customerReference),
    summary: sanitizeExternalIssueSummary(raw.summary),
    linkedAt: raw.linkedAt ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function sanitizeExternalIssueForAudit(raw: RawExternalIssueRecord) {
  return {
    id: raw.id,
    sourceKind: sanitizeExternalIssueSourceKind(raw.sourceKind),
    externalId: sanitizeExternalIssueIdentifier(raw.externalId),
    externalKey: sanitizeExternalIssueKey(raw.externalKey),
    title: sanitizeExternalIssueTitle(raw.title),
    status: sanitizeExternalIssueStatus(raw.status),
    priority: sanitizeExternalIssuePriority(raw.priority),
    sourceUrl: sanitizeExternalIssueUrl(raw.sourceUrl),
    customerReference: sanitizeExternalIssueCustomerReference(raw.customerReference),
    summary: sanitizeExternalIssueSummary(raw.summary),
    linkedAt: raw.linkedAt ?? null,
    updatedAt: raw.updatedAt,
  };
}
