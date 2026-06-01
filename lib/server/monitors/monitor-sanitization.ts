type PublicMonitorType =
  | "http"
  | "api_health"
  | "json_assertion"
  | "latency_threshold"
  | "ssl_expiry"
  | "heartbeat";

export type RawMonitorRecord = {
  id: string;
  organizationId: string;
  appId: string;
  environmentId: string | null;
  name: string;
  slug: string;
  type: PublicMonitorType;
  status: string;
  isEnabled: boolean;
  requestMethod: string | null;
  targetUrl: string | null;
  expectedStatusCodes: number[];
  intervalSeconds: number;
  nextCheckAt: string | null;
  timeoutMs: number;
  latencyThresholdMs: number | null;
  consecutiveFailureThreshold: number;
  consecutiveRecoveryThreshold: number;
  configuration: Record<string, unknown>;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SafeMonitorSummary = {
  id: string;
  appId: string;
  environmentId: string | null;
  name: string;
  slug: string;
  type: PublicMonitorType;
  status: string;
  isEnabled: boolean;
  requestMethod: string | null;
  targetSummary: string | null;
  expectedStatusCodes: number[];
  intervalSeconds: number;
  nextCheckAt: string | null;
  timeoutMs: number;
  latencyThresholdMs: number | null;
  consecutiveFailureThreshold: number;
  consecutiveRecoveryThreshold: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  hasStoredConfiguration: boolean;
  configurationSummary: string | null;
};

export type SafeMonitorAuditRecord = {
  id: string;
  appId: string;
  environmentId: string | null;
  name: string;
  slug: string;
  type: PublicMonitorType;
  status: string;
  isEnabled: boolean;
  requestMethod: string | null;
  targetSummary: string | null;
  expectedStatusCodes: number[];
  intervalSeconds: number;
  nextCheckAt: string | null;
  timeoutMs: number;
  latencyThresholdMs: number | null;
  consecutiveFailureThreshold: number;
  consecutiveRecoveryThreshold: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  hasStoredConfiguration: boolean;
};

function redactPathSegment(segment: string) {
  if (!segment) {
    return segment;
  }

  if (
    segment.length > 24 ||
    /^[a-f0-9]{16,}$/i.test(segment) ||
    /^[A-Za-z0-9_-]{20,}$/.test(segment)
  ) {
    return "[redacted]";
  }

  return segment;
}

export function maskMonitorTarget(targetUrl: string | null) {
  if (!targetUrl) {
    return null;
  }

  try {
    const parsed = new URL(targetUrl);
    const pathname =
      parsed.pathname === "/"
        ? ""
        : parsed.pathname
            .split("/")
            .map((segment) => redactPathSegment(segment))
            .join("/");

    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return "Configured target";
  }
}

export function sanitizeMonitorConfigForDisplay(configuration: Record<string, unknown>) {
  const keys = Object.keys(configuration);

  if (keys.length === 0) {
    return {
      hasStoredConfiguration: false,
      configurationSummary: null,
    };
  }

  return {
    hasStoredConfiguration: true,
    configurationSummary: `Additional monitor configuration is stored server-side (${keys.length} hidden field${keys.length === 1 ? "" : "s"}).`,
  };
}

export function toSafeMonitorSummary(rawMonitor: RawMonitorRecord): SafeMonitorSummary {
  const sanitizedConfig = sanitizeMonitorConfigForDisplay(rawMonitor.configuration);

  return {
    id: rawMonitor.id,
    appId: rawMonitor.appId,
    environmentId: rawMonitor.environmentId,
    name: rawMonitor.name,
    slug: rawMonitor.slug,
    type: rawMonitor.type,
    status: rawMonitor.status,
    isEnabled: rawMonitor.isEnabled,
    requestMethod: rawMonitor.requestMethod,
    targetSummary: maskMonitorTarget(rawMonitor.targetUrl),
    expectedStatusCodes: rawMonitor.expectedStatusCodes,
    intervalSeconds: rawMonitor.intervalSeconds,
    nextCheckAt: rawMonitor.nextCheckAt,
    timeoutMs: rawMonitor.timeoutMs,
    latencyThresholdMs: rawMonitor.latencyThresholdMs,
    consecutiveFailureThreshold: rawMonitor.consecutiveFailureThreshold,
    consecutiveRecoveryThreshold: rawMonitor.consecutiveRecoveryThreshold,
    description: rawMonitor.description,
    createdAt: rawMonitor.createdAt,
    updatedAt: rawMonitor.updatedAt,
    hasStoredConfiguration: sanitizedConfig.hasStoredConfiguration,
    configurationSummary: sanitizedConfig.configurationSummary,
  };
}

export function toSafeMonitorDetail(rawMonitor: RawMonitorRecord) {
  return toSafeMonitorSummary(rawMonitor);
}

export function sanitizeMonitorForAudit(rawMonitor: RawMonitorRecord): SafeMonitorAuditRecord {
  const safeMonitor = toSafeMonitorSummary(rawMonitor);

  return {
    id: safeMonitor.id,
    appId: safeMonitor.appId,
    environmentId: safeMonitor.environmentId,
    name: safeMonitor.name,
    slug: safeMonitor.slug,
    type: safeMonitor.type,
    status: safeMonitor.status,
    isEnabled: safeMonitor.isEnabled,
    requestMethod: safeMonitor.requestMethod,
    targetSummary: safeMonitor.targetSummary,
    expectedStatusCodes: safeMonitor.expectedStatusCodes,
    intervalSeconds: safeMonitor.intervalSeconds,
    nextCheckAt: safeMonitor.nextCheckAt,
    timeoutMs: safeMonitor.timeoutMs,
    latencyThresholdMs: safeMonitor.latencyThresholdMs,
    consecutiveFailureThreshold: safeMonitor.consecutiveFailureThreshold,
    consecutiveRecoveryThreshold: safeMonitor.consecutiveRecoveryThreshold,
    description: safeMonitor.description,
    createdAt: safeMonitor.createdAt,
    updatedAt: safeMonitor.updatedAt,
    hasStoredConfiguration: safeMonitor.hasStoredConfiguration,
  };
}
