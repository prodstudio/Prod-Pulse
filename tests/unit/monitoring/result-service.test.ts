import { describe, expect, it, vi } from "vitest";

import {
  buildMonitorStatePatch,
  persistMonitorExecutionResult,
} from "@/lib/server/monitoring/result-service";
import type { MonitorExecutionResult } from "@/lib/server/monitoring/evaluate";
import type { RawMonitorRecord } from "@/lib/server/monitors/monitor-sanitization";

function createChain(result: { data?: unknown; error?: { message: string; code?: string } }) {
  return {
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: result.data ?? null,
      error: result.error ?? null,
    }),
  };
}

const monitor: RawMonitorRecord = {
  id: "monitor-1",
  organizationId: "org-1",
  appId: "app-1",
  environmentId: "env-1",
  name: "API health",
  slug: "api-health",
  type: "api_health",
  status: "unknown",
  isEnabled: true,
  requestMethod: "GET",
  targetUrl: "https://example.com/health",
  expectedStatusCodes: [200],
  intervalSeconds: 300,
  nextCheckAt: null,
  timeoutMs: 10000,
  latencyThresholdMs: null,
  consecutiveFailureThreshold: 3,
  consecutiveRecoveryThreshold: 2,
  configuration: {},
  description: null,
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
};

const execution: MonitorExecutionResult = {
  status: "success",
  checkedAt: "2026-06-01T00:00:00Z",
  startedAt: "2026-06-01T00:00:00Z",
  finishedAt: "2026-06-01T00:00:01Z",
  durationMs: 1000,
  httpStatus: 200,
  errorCode: null,
  errorMessage: null,
  responseExcerpt: "ok",
  assertionResults: {},
  metadata: {
    service: "tiquer",
  },
  attempts: [
    {
      attemptNumber: 1,
      status: "success",
      startedAt: "2026-06-01T00:00:00Z",
      finishedAt: "2026-06-01T00:00:01Z",
      durationMs: 1000,
      httpStatus: 200,
      errorCode: null,
      errorMessage: null,
    },
  ],
};

describe("result service", () => {
  it("builds a conservative monitor state patch", () => {
    expect(buildMonitorStatePatch(monitor, execution)).toEqual({
      last_checked_at: "2026-06-01T00:00:00Z",
      last_success_at: "2026-06-01T00:00:00Z",
    });
  });

  it("does not force a down status from a single failed manual run", () => {
    expect(
      buildMonitorStatePatch(monitor, {
        ...execution,
        status: "failure",
        errorCode: "HTTP_503",
        errorMessage: "The endpoint responded with HTTP 503.",
      }),
    ).toEqual({
      last_checked_at: "2026-06-01T00:00:00Z",
      last_failure_at: "2026-06-01T00:00:00Z",
    });
  });

  it("persists a sanitized monitor result and attempts", async () => {
    const resultsChain = createChain({
      data: {
        id: "result-1",
        status: "success",
        trigger_source: "manual",
        checked_at: "2026-06-01T00:00:00Z",
        duration_ms: 1000,
        http_status: 200,
        error_code: null,
        error_message: null,
        response_excerpt: "ok",
        assertion_results: {},
        metadata: {
          service: "tiquer",
        },
      },
    });
    const attemptsInsert = vi.fn().mockResolvedValue({ error: null });
    const monitorUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "monitor_results") {
          return resultsChain;
        }

        if (table === "monitor_result_attempts") {
          return {
            insert: attemptsInsert,
          };
        }

        if (table === "monitors") {
          return {
            ...monitorUpdate,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await persistMonitorExecutionResult(
      {
        actorUserId: "user-1",
        monitor,
        execution,
      },
      adminClient as never,
    );

    expect(result.status).toBe("success");
    expect(resultsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        trigger_source: "manual",
      }),
    );
    expect(attemptsInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          attempt_number: 1,
          status: "success",
        }),
      ]),
    );
  });
});
