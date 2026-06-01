import { describe, expect, it, vi } from "vitest";

import { evaluateMonitor } from "@/lib/server/monitoring/evaluate";
import type { RawMonitorRecord } from "@/lib/server/monitors/monitor-sanitization";

function createMonitor(
  overrides: Partial<RawMonitorRecord> = {},
): RawMonitorRecord {
  return {
    id: "monitor-1",
    organizationId: "org-1",
    appId: "app-1",
    environmentId: "env-1",
    name: "Monitor",
    slug: "monitor",
    type: "http",
    status: "unknown",
    isEnabled: true,
    requestMethod: "GET",
    targetUrl: "https://example.com/health",
    expectedStatusCodes: [200],
    intervalSeconds: 300,
    nextCheckAt: null,
    timeoutMs: 10000,
    latencyThresholdMs: 500,
    consecutiveFailureThreshold: 3,
    consecutiveRecoveryThreshold: 2,
    configuration: {},
    description: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function createHttpExecutionResult(
  overrides: Partial<{
    responseJson: unknown;
    responseText: string | null;
    httpStatus: number | null;
    durationMs: number | null;
    errorCode: string | null;
    errorMessage: string | null;
  }> = {},
) {
  return {
    attempts: [
      {
        attemptNumber: 1,
        status: "success" as const,
        startedAt: "2026-06-01T00:00:00Z",
        finishedAt: "2026-06-01T00:00:01Z",
        durationMs: 1000,
        httpStatus: 200,
        errorCode: null,
        errorMessage: null,
      },
    ],
    responseText: JSON.stringify({ ok: true }),
    responseJson: { ok: true },
    httpStatus: 200,
    durationMs: 1000,
    startedAt: "2026-06-01T00:00:00Z",
    finishedAt: "2026-06-01T00:00:01Z",
    errorCode: null,
    errorMessage: null,
    contentType: "application/json",
    ...overrides,
  };
}

describe("evaluateMonitor", () => {
  it("handles health contract ok and degraded statuses", async () => {
    const executeHttpRequestImpl = vi
      .fn()
      .mockResolvedValueOnce(
        createHttpExecutionResult({
          responseJson: {
            status: "ok",
            service: "tiquer",
            environment: "production",
            timestamp: "2026-06-01T00:00:00Z",
            checks: {
              database: { status: "ok" },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        createHttpExecutionResult({
          responseJson: {
            status: "degraded",
            service: "tiquer",
            environment: "production",
            timestamp: "2026-06-01T00:00:00Z",
            checks: {
              database: { status: "degraded" },
            },
          },
        }),
      );

    const okResult = await evaluateMonitor(
      createMonitor({ type: "api_health" }),
      { executeHttpRequestImpl, now: new Date("2026-06-01T00:01:00Z") },
    );
    const degradedResult = await evaluateMonitor(
      createMonitor({ type: "api_health" }),
      { executeHttpRequestImpl, now: new Date("2026-06-01T00:01:00Z") },
    );

    expect(okResult.status).toBe("success");
    expect(degradedResult.status).toBe("degraded");
  });

  it("marks down and malformed health payloads as failures", async () => {
    const executeHttpRequestImpl = vi
      .fn()
      .mockResolvedValueOnce(
        createHttpExecutionResult({
          responseJson: {
            status: "down",
            service: "tiquer",
            environment: "production",
            timestamp: "2026-06-01T00:00:00Z",
            checks: { database: { status: "down" } },
          },
        }),
      )
      .mockResolvedValueOnce(
        createHttpExecutionResult({
          responseJson: {
            service: "tiquer",
            environment: "production",
          },
        }),
      );

    const downResult = await evaluateMonitor(createMonitor({ type: "api_health" }), {
      executeHttpRequestImpl,
      now: new Date("2026-06-01T00:01:00Z"),
    });
    const malformedResult = await evaluateMonitor(createMonitor({ type: "api_health" }), {
      executeHttpRequestImpl,
      now: new Date("2026-06-01T00:01:00Z"),
    });

    expect(downResult.status).toBe("failure");
    expect(malformedResult.errorCode).toBe("HEALTH_VALIDATION_FAILED");
  });

  it("fails stale health responses when max age is configured", async () => {
    const executeHttpRequestImpl = vi.fn().mockResolvedValue(
      createHttpExecutionResult({
        responseJson: {
          status: "ok",
          service: "tiquer",
          environment: "production",
          timestamp: "2026-05-31T23:30:00Z",
          checks: { database: { status: "ok" } },
        },
      }),
    );

    const result = await evaluateMonitor(
      createMonitor({
        type: "api_health",
        configuration: {
          health: {
            maxAgeMs: 60_000,
          },
        },
      }),
      { executeHttpRequestImpl, now: new Date("2026-06-01T00:00:00Z") },
    );

    expect(result.status).toBe("failure");
    expect(result.metadata.note).toBe("Health contract validation failed");
  });

  it("fails health monitors when the HTTP status is unexpected even if the JSON body looks healthy", async () => {
    const executeHttpRequestImpl = vi.fn().mockResolvedValue(
      createHttpExecutionResult({
        httpStatus: 503,
        errorCode: "HTTP_503",
        errorMessage: "The endpoint responded with HTTP 503.",
        responseJson: {
          status: "ok",
          service: "tiquer",
          environment: "production",
          timestamp: "2026-06-01T00:00:00Z",
          checks: { database: { status: "ok" } },
        },
      }),
    );

    const result = await evaluateMonitor(createMonitor({ type: "api_health" }), {
      executeHttpRequestImpl,
      now: new Date("2026-06-01T00:01:00Z"),
    });

    expect(result.status).toBe("failure");
    expect(result.errorCode).toBe("HTTP_503");
  });

  it("handles JSON assertion pass and fail results", async () => {
    const executeHttpRequestImpl = vi
      .fn()
      .mockResolvedValueOnce(
        createHttpExecutionResult({
          responseJson: {
            checks: {
              database: {
                status: "ok",
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        createHttpExecutionResult({
          responseJson: {
            checks: {
              database: {
                status: "down",
              },
            },
          },
        }),
      );

    const passingMonitor = createMonitor({
      type: "json_assertion",
      configuration: {
        assertion: {
          path: "$.checks.database.status",
          expected: "ok",
        },
      },
    });

    const passingResult = await evaluateMonitor(passingMonitor, { executeHttpRequestImpl });
    const failingResult = await evaluateMonitor(passingMonitor, { executeHttpRequestImpl });

    expect(passingResult.status).toBe("success");
    expect(failingResult.status).toBe("failure");
    expect(failingResult.errorCode).toBe("ASSERTION_FAILED");
  });

  it("fails JSON assertion monitors when the HTTP status is unexpected", async () => {
    const executeHttpRequestImpl = vi.fn().mockResolvedValue(
      createHttpExecutionResult({
        httpStatus: 500,
        errorCode: "HTTP_500",
        errorMessage: "The endpoint responded with HTTP 500.",
        responseJson: {
          checks: {
            database: {
              status: "ok",
            },
          },
        },
      }),
    );

    const result = await evaluateMonitor(
      createMonitor({
        type: "json_assertion",
        configuration: {
          assertion: {
            path: "$.checks.database.status",
            expected: "ok",
          },
        },
      }),
      { executeHttpRequestImpl },
    );

    expect(result.status).toBe("failure");
    expect(result.errorCode).toBe("HTTP_500");
  });

  it("marks latency threshold monitors degraded when the threshold is exceeded", async () => {
    const executeHttpRequestImpl = vi
      .fn()
      .mockResolvedValueOnce(createHttpExecutionResult({ durationMs: 200 }))
      .mockResolvedValueOnce(createHttpExecutionResult({ durationMs: 900 }));

    const monitor = createMonitor({
      type: "latency_threshold",
      latencyThresholdMs: 500,
    });

    const successResult = await evaluateMonitor(monitor, { executeHttpRequestImpl });
    const degradedResult = await evaluateMonitor(monitor, { executeHttpRequestImpl });

    expect(successResult.status).toBe("success");
    expect(degradedResult.status).toBe("degraded");
  });
});
