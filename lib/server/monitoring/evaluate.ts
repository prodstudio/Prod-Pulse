import "server-only";

import "server-only";

import { evaluateHeartbeatFreshness } from "@/lib/server/heartbeats/heartbeat-evaluator";
import { getRawHeartbeatByMonitorId } from "@/lib/server/heartbeats/heartbeat-service";
import type { RawMonitorRecord } from "@/lib/server/monitors/monitor-sanitization";
import { validateHealthResponse } from "@/lib/health/validate-health-response";
import { executeHttpRequest, type HttpExecutionResult } from "@/lib/server/monitoring/http";
import { executeSslExpiryCheck } from "@/lib/server/monitoring/ssl";

export type MonitorExecutionAttempt = {
  attemptNumber: number;
  status: "success" | "degraded" | "failure" | "timeout" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type MonitorExecutionResult = {
  status: "success" | "degraded" | "failure" | "timeout" | "error" | "skipped";
  checkedAt: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  responseExcerpt: string | null;
  assertionResults: Record<string, unknown>;
  metadata: Record<string, unknown>;
  attempts: MonitorExecutionAttempt[];
};

type EvaluateDependencies = {
  executeHttpRequestImpl?: typeof executeHttpRequest;
  executeSslExpiryCheckImpl?: typeof executeSslExpiryCheck;
  getRawHeartbeatByMonitorIdImpl?: typeof getRawHeartbeatByMonitorId;
  now?: Date;
};

type JsonAssertionRule = {
  path: string;
  equals?: string | number | boolean | null;
  exists?: boolean;
};

function toComparableAssertionValue(
  value: unknown,
): string | number | boolean | null | undefined {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return undefined;
}

function mapHttpAttempts(result: HttpExecutionResult): MonitorExecutionAttempt[] {
  return result.attempts.map((attempt) => ({
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    durationMs: attempt.durationMs,
    httpStatus: attempt.httpStatus,
    errorCode: attempt.errorCode,
    errorMessage: attempt.errorMessage,
  }));
}

function buildResult(
  partial: Omit<MonitorExecutionResult, "checkedAt"> & { checkedAt?: string },
): MonitorExecutionResult {
  return {
    checkedAt: partial.checkedAt ?? new Date().toISOString(),
    ...partial,
  };
}

function getConfigNumber(
  configuration: Record<string, unknown>,
  key: string,
  nestedKey?: string,
): number | null {
  const direct = configuration[key];
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }

  if (!nestedKey) {
    return null;
  }

  const nested = configuration[nestedKey];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedValue = (nested as Record<string, unknown>)[key];
    if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
      return nestedValue;
    }
  }

  return null;
}

function getConfigStringArray(
  configuration: Record<string, unknown>,
  key: string,
  nestedKey?: string,
): string[] {
  const direct = configuration[key];
  if (Array.isArray(direct)) {
    return direct.filter((value): value is string => typeof value === "string");
  }

  if (!nestedKey) {
    return [];
  }

  const nested = configuration[nestedKey];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedValue = (nested as Record<string, unknown>)[key];
    if (Array.isArray(nestedValue)) {
      return nestedValue.filter((value): value is string => typeof value === "string");
    }
  }

  return [];
}

function getThresholdStatus(configuration: Record<string, unknown>) {
  return configuration.thresholdStatus === "failure" ? "failure" : "degraded";
}

function getJsonValueAtPath(input: unknown, rawPath: string): unknown {
  const normalizedPath = rawPath.replace(/^\$\./, "").replace(/^\$/, "");
  if (!normalizedPath) {
    return input;
  }

  return normalizedPath.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, input);
}

// Minimal assertion support for Phase 3: a single assertion or an array of assertions
// using dot-paths / $.dot.paths with equals or exists checks.
function getJsonAssertions(configuration: Record<string, unknown>): JsonAssertionRule[] {
  const directAssertions = configuration.assertions;
  if (Array.isArray(directAssertions)) {
    return directAssertions.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }

      const record = value as Record<string, unknown>;
      if (typeof record.path !== "string") {
        return [];
      }

      return [
        {
          path: record.path,
          equals: toComparableAssertionValue(record.expected ?? record.equals),
          exists: typeof record.exists === "boolean" ? record.exists : undefined,
        },
      ];
    });
  }

  const directAssertion = configuration.assertion;
  if (directAssertion && typeof directAssertion === "object" && !Array.isArray(directAssertion)) {
    const record = directAssertion as Record<string, unknown>;
    if (typeof record.path === "string") {
      return [
        {
          path: record.path,
          equals: toComparableAssertionValue(record.expected ?? record.equals),
          exists: typeof record.exists === "boolean" ? record.exists : undefined,
        },
      ];
    }
  }

  return [];
}

function summarizeResponseText(responseText: string | null) {
  if (!responseText) {
    return null;
  }

  return responseText.slice(0, 1000);
}

async function evaluateHttpLikeMonitor(
  monitor: RawMonitorRecord,
  executeHttpRequestImpl: typeof executeHttpRequest,
): Promise<HttpExecutionResult> {
  return executeHttpRequestImpl({
    targetUrl: monitor.targetUrl ?? "",
    requestMethod: monitor.requestMethod ?? "GET",
    timeoutMs: monitor.timeoutMs,
  });
}

function hasExpectedHttpStatus(monitor: RawMonitorRecord, httpResult: HttpExecutionResult) {
  return httpResult.httpStatus
    ? monitor.expectedStatusCodes.includes(httpResult.httpStatus)
    : false;
}

function mapTransportStatus(httpResult: HttpExecutionResult): MonitorExecutionResult["status"] {
  if (httpResult.errorCode === "REQUEST_TIMEOUT") {
    return "timeout";
  }

  if (httpResult.errorCode === "NETWORK_ERROR") {
    return "error";
  }

  return "failure";
}

async function evaluateHttpMonitor(
  monitor: RawMonitorRecord,
  executeHttpRequestImpl: typeof executeHttpRequest,
): Promise<MonitorExecutionResult> {
  const httpResult = await evaluateHttpLikeMonitor(monitor, executeHttpRequestImpl);
  const passed = httpResult.httpStatus
    ? monitor.expectedStatusCodes.includes(httpResult.httpStatus)
    : false;

  return buildResult({
    startedAt: httpResult.startedAt,
    finishedAt: httpResult.finishedAt,
    durationMs: httpResult.durationMs,
    httpStatus: httpResult.httpStatus,
    status: passed
      ? "success"
      : httpResult.errorCode === "REQUEST_TIMEOUT"
        ? "timeout"
        : httpResult.errorCode === "NETWORK_ERROR"
          ? "error"
          : "failure",
    errorCode: passed ? null : httpResult.errorCode,
    errorMessage: passed ? null : httpResult.errorMessage,
    responseExcerpt: summarizeResponseText(httpResult.responseText),
    assertionResults: {},
    metadata: {},
    attempts: mapHttpAttempts(httpResult),
  });
}

async function evaluateApiHealthMonitor(
  monitor: RawMonitorRecord,
  executeHttpRequestImpl: typeof executeHttpRequest,
  now: Date,
): Promise<MonitorExecutionResult> {
  const httpResult = await evaluateHttpLikeMonitor(monitor, executeHttpRequestImpl);

  if (!hasExpectedHttpStatus(monitor, httpResult)) {
    return buildResult({
      startedAt: httpResult.startedAt,
      finishedAt: httpResult.finishedAt,
      durationMs: httpResult.durationMs,
      httpStatus: httpResult.httpStatus,
      status: mapTransportStatus(httpResult),
      errorCode: httpResult.errorCode ?? "HEALTH_HTTP_STATUS_UNEXPECTED",
      errorMessage: httpResult.errorMessage ?? "The health endpoint returned an unexpected HTTP status.",
      responseExcerpt: summarizeResponseText(httpResult.responseText),
      assertionResults: {},
      metadata: {
        note: "Health endpoint request failed",
      },
      attempts: mapHttpAttempts(httpResult),
    });
  }

  const maxAgeMs =
    getConfigNumber(monitor.configuration, "maxAgeMs", "health") ??
    (() => {
      const maxAgeSeconds = getConfigNumber(
        monitor.configuration,
        "maxAgeSeconds",
        "health",
      );
      return maxAgeSeconds == null ? undefined : maxAgeSeconds * 1000;
    })();
  const healthResult = validateHealthResponse(httpResult.responseJson, {
    maxAgeMs,
    requiredChecks: getConfigStringArray(monitor.configuration, "requiredChecks", "health"),
    now,
  });

  if (!healthResult.success) {
    return buildResult({
      startedAt: httpResult.startedAt,
      finishedAt: httpResult.finishedAt,
      durationMs: httpResult.durationMs,
      httpStatus: httpResult.httpStatus,
      status: httpResult.errorCode === "REQUEST_TIMEOUT" ? "timeout" : "failure",
      errorCode: httpResult.errorCode ?? "HEALTH_VALIDATION_FAILED",
      errorMessage:
        httpResult.errorMessage ?? "The health endpoint response did not match the contract.",
      responseExcerpt: summarizeResponseText(httpResult.responseText),
      assertionResults: {
        errors: healthResult.errors,
      },
      metadata: {
        note: "Health contract validation failed",
        missingChecks: healthResult.errors
          .filter((message) => message.startsWith("missing required check:"))
          .map((message) => message.replace("missing required check: ", "")),
      },
      attempts: mapHttpAttempts(httpResult),
    });
  }

  const status =
    healthResult.data.status === "ok"
      ? "success"
      : healthResult.data.status === "degraded"
        ? "degraded"
        : "failure";

  return buildResult({
    startedAt: httpResult.startedAt,
    finishedAt: httpResult.finishedAt,
    durationMs: httpResult.durationMs,
    httpStatus: httpResult.httpStatus,
    status,
    errorCode: status === "failure" ? "HEALTH_STATUS_DOWN" : null,
    errorMessage:
      status === "failure" ? "The health endpoint reported a down status." : null,
    responseExcerpt: summarizeResponseText(httpResult.responseText),
    assertionResults: {},
    metadata: {
      healthStatus: healthResult.data.status,
      service: healthResult.data.service,
      environment: healthResult.data.environment,
    },
    attempts: mapHttpAttempts(httpResult),
  });
}

async function evaluateJsonAssertionMonitor(
  monitor: RawMonitorRecord,
  executeHttpRequestImpl: typeof executeHttpRequest,
): Promise<MonitorExecutionResult> {
  const httpResult = await evaluateHttpLikeMonitor(monitor, executeHttpRequestImpl);
  const assertions = getJsonAssertions(monitor.configuration);

  if (!hasExpectedHttpStatus(monitor, httpResult)) {
    return buildResult({
      startedAt: httpResult.startedAt,
      finishedAt: httpResult.finishedAt,
      durationMs: httpResult.durationMs,
      httpStatus: httpResult.httpStatus,
      status: mapTransportStatus(httpResult),
      errorCode: httpResult.errorCode ?? "JSON_ASSERTION_HTTP_STATUS_UNEXPECTED",
      errorMessage: httpResult.errorMessage ?? "The endpoint returned an unexpected HTTP status.",
      responseExcerpt: summarizeResponseText(httpResult.responseText),
      assertionResults: {},
      metadata: {
        note: "JSON assertion request failed",
      },
      attempts: mapHttpAttempts(httpResult),
    });
  }

  if (httpResult.errorCode && !httpResult.responseJson) {
    return buildResult({
      startedAt: httpResult.startedAt,
      finishedAt: httpResult.finishedAt,
      durationMs: httpResult.durationMs,
      httpStatus: httpResult.httpStatus,
      status: mapTransportStatus(httpResult),
      errorCode: httpResult.errorCode,
      errorMessage: httpResult.errorMessage,
      responseExcerpt: summarizeResponseText(httpResult.responseText),
      assertionResults: {},
      metadata: {},
      attempts: mapHttpAttempts(httpResult),
    });
  }

  if (!httpResult.responseJson) {
    return buildResult({
      startedAt: httpResult.startedAt,
      finishedAt: httpResult.finishedAt,
      durationMs: httpResult.durationMs,
      httpStatus: httpResult.httpStatus,
      status: "failure",
      errorCode: "INVALID_JSON_RESPONSE",
      errorMessage: "The monitor response was not valid JSON.",
      responseExcerpt: summarizeResponseText(httpResult.responseText),
      assertionResults: {},
      metadata: {
        note: "JSON parsing failed",
      },
      attempts: mapHttpAttempts(httpResult),
    });
  }

  if (assertions.length === 0) {
    return buildResult({
      startedAt: httpResult.startedAt,
      finishedAt: httpResult.finishedAt,
      durationMs: httpResult.durationMs,
      httpStatus: httpResult.httpStatus,
      status: "failure",
      errorCode: "ASSERTION_CONFIG_MISSING",
      errorMessage: "JSON assertions are not configured for this monitor.",
      responseExcerpt: summarizeResponseText(httpResult.responseText),
      assertionResults: {},
      metadata: {
        note: "JSON assertions missing",
      },
      attempts: mapHttpAttempts(httpResult),
    });
  }

  const results = assertions.map((assertion) => {
    const actualValue = getJsonValueAtPath(httpResult.responseJson, assertion.path);
    const existsPassed =
      assertion.exists === undefined ? true : (actualValue !== undefined) === assertion.exists;
    const equalsPassed =
      assertion.equals === undefined ? true : Object.is(actualValue, assertion.equals);

    return {
      path: assertion.path,
      passed: existsPassed && equalsPassed,
      actualValue:
        actualValue == null || typeof actualValue === "string" || typeof actualValue === "number"
          ? actualValue
          : "[object]",
    };
  });

  const passed = results.every((result) => result.passed);

  return buildResult({
    startedAt: httpResult.startedAt,
    finishedAt: httpResult.finishedAt,
    durationMs: httpResult.durationMs,
    httpStatus: httpResult.httpStatus,
    status: passed ? "success" : "failure",
    errorCode: passed ? null : "ASSERTION_FAILED",
    errorMessage: passed ? null : "One or more JSON assertions failed.",
    responseExcerpt: summarizeResponseText(httpResult.responseText),
    assertionResults: {
      results,
    },
    metadata: {
      note: passed ? "JSON assertions passed" : "JSON assertions failed",
    },
    attempts: mapHttpAttempts(httpResult),
  });
}

async function evaluateLatencyThresholdMonitor(
  monitor: RawMonitorRecord,
  executeHttpRequestImpl: typeof executeHttpRequest,
): Promise<MonitorExecutionResult> {
  const httpResult = await evaluateHttpLikeMonitor(monitor, executeHttpRequestImpl);
  const thresholdMs = monitor.latencyThresholdMs ?? 0;
  const thresholdStatus = getThresholdStatus(monitor.configuration);
  const passed = httpResult.httpStatus
    ? monitor.expectedStatusCodes.includes(httpResult.httpStatus)
    : false;
  const exceeded = typeof httpResult.durationMs === "number" && httpResult.durationMs > thresholdMs;

  return buildResult({
    startedAt: httpResult.startedAt,
    finishedAt: httpResult.finishedAt,
    durationMs: httpResult.durationMs,
    httpStatus: httpResult.httpStatus,
    status: !passed
      ? httpResult.errorCode === "REQUEST_TIMEOUT"
        ? "timeout"
        : "failure"
      : exceeded
        ? thresholdStatus
        : "success",
    errorCode: !passed
      ? httpResult.errorCode
      : exceeded
        ? "LATENCY_THRESHOLD_EXCEEDED"
        : null,
    errorMessage: !passed
      ? httpResult.errorMessage
      : exceeded
        ? `The latency threshold of ${thresholdMs} ms was exceeded.`
        : null,
    responseExcerpt: summarizeResponseText(httpResult.responseText),
    assertionResults: {},
    metadata: {
      thresholdMs,
      thresholdStatus,
    },
    attempts: mapHttpAttempts(httpResult),
  });
}

async function evaluateSslMonitor(
  monitor: RawMonitorRecord,
  executeSslExpiryCheckImpl: typeof executeSslExpiryCheck,
): Promise<MonitorExecutionResult> {
  const sslResult = await executeSslExpiryCheckImpl({
    targetUrl: monitor.targetUrl ?? "",
    timeoutMs: monitor.timeoutMs,
    warningDays: getConfigNumber(monitor.configuration, "warningDays", "ssl") ?? 30,
  });

  return buildResult({
    startedAt: sslResult.startedAt,
    finishedAt: sslResult.finishedAt,
    durationMs: sslResult.durationMs,
    httpStatus: null,
    status: sslResult.status,
    errorCode: sslResult.errorCode,
    errorMessage: sslResult.errorMessage,
    responseExcerpt: null,
    assertionResults: {},
    metadata: {
      daysUntilExpiry: sslResult.daysUntilExpiry,
      expiresAt: sslResult.expiresAt,
    },
    attempts: sslResult.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      durationMs: attempt.durationMs,
      httpStatus: null,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
    })),
  });
}

async function evaluateHeartbeatMonitor(
  monitor: RawMonitorRecord,
  now: Date,
  getRawHeartbeatByMonitorIdImpl: typeof getRawHeartbeatByMonitorId,
) {
  const heartbeat = await getRawHeartbeatByMonitorIdImpl(
    monitor.organizationId,
    monitor.id,
  );

  return evaluateHeartbeatFreshness({
    monitor,
    heartbeat,
    now,
  });
}

export async function evaluateMonitor(
  monitor: RawMonitorRecord,
  dependencies: EvaluateDependencies = {},
): Promise<MonitorExecutionResult> {
  const executeHttpRequestImpl = dependencies.executeHttpRequestImpl ?? executeHttpRequest;
  const executeSslExpiryCheckImpl =
    dependencies.executeSslExpiryCheckImpl ?? executeSslExpiryCheck;
  const getRawHeartbeatByMonitorIdImpl =
    dependencies.getRawHeartbeatByMonitorIdImpl ?? getRawHeartbeatByMonitorId;
  const now = dependencies.now ?? new Date();

  switch (monitor.type) {
    case "http":
      return evaluateHttpMonitor(monitor, executeHttpRequestImpl);
    case "api_health":
      return evaluateApiHealthMonitor(monitor, executeHttpRequestImpl, now);
    case "json_assertion":
      return evaluateJsonAssertionMonitor(monitor, executeHttpRequestImpl);
    case "latency_threshold":
      return evaluateLatencyThresholdMonitor(monitor, executeHttpRequestImpl);
    case "ssl_expiry":
      return evaluateSslMonitor(monitor, executeSslExpiryCheckImpl);
    case "heartbeat":
      return evaluateHeartbeatMonitor(monitor, now, getRawHeartbeatByMonitorIdImpl);
    default:
      return buildResult({
        checkedAt: now.toISOString(),
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        durationMs: 0,
        httpStatus: null,
        status: "error",
        errorCode: "UNSUPPORTED_MONITOR_TYPE",
        errorMessage: "This monitor type is not supported.",
        responseExcerpt: null,
        assertionResults: {},
        metadata: {},
        attempts: [],
      });
  }
}
