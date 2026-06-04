import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("manual monitor execution", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/server/audit/audit-log");
    vi.doUnmock("@/lib/server/incidents/incident-engine");
    vi.doUnmock("@/lib/server/monitoring/evaluate");
    vi.doUnmock("@/lib/server/monitoring/result-service");
    vi.doUnmock("@/lib/server/monitors/monitor-sanitization");
    vi.doUnmock("@/lib/server/monitors/monitor-service");
    vi.doUnmock("@/lib/server/supabase/admin");
  });

  it("persists a manual check result and forwards it to the incident engine", async () => {
    const persistMonitorExecutionResult = vi.fn().mockResolvedValue({
      id: "result-1",
      status: "failure",
      triggerSource: "manual",
      checkedAt: "2026-06-01T00:00:00Z",
      httpStatus: 503,
      errorCode: "HTTP_503",
      errorSummary: "The endpoint responded with HTTP 503.",
      responseSummary: null,
      assertionSummary: null,
      metadataSummary: null,
    });
    const processScheduledIncidentState = vi.fn().mockResolvedValue({
      created: true,
      updated: false,
      incidentId: "incident-1",
      action: "created",
    });

    vi.doMock("@/lib/server/audit/audit-log", () => ({
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("@/lib/server/incidents/incident-engine", () => ({
      processScheduledIncidentState,
    }));

    vi.doMock("@/lib/server/monitoring/evaluate", () => ({
      evaluateMonitor: vi.fn().mockResolvedValue({
        status: "failure",
        checkedAt: "2026-06-01T00:00:00Z",
        startedAt: "2026-06-01T00:00:00Z",
        finishedAt: "2026-06-01T00:00:01Z",
        durationMs: 1000,
        httpStatus: 503,
        errorCode: "HTTP_503",
        errorMessage: "The endpoint responded with HTTP 503.",
        responseExcerpt: null,
        assertionResults: {},
        metadata: {},
        attempts: [],
      }),
    }));

    vi.doMock("@/lib/server/monitoring/result-service", () => ({
      persistMonitorExecutionResult,
    }));

    vi.doMock("@/lib/server/monitors/monitor-service", () => ({
      getRawMonitorForExecution: vi.fn().mockResolvedValue({
        id: "monitor-1",
        organizationId: "org-1",
        appId: "app-1",
        environmentId: "env-1",
        name: "API health",
        slug: "api-health",
        type: "http",
        status: "operational",
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
      }),
    }));

    vi.doMock("@/lib/server/monitors/monitor-sanitization", () => ({
      sanitizeMonitorForAudit: vi.fn().mockReturnValue({
        id: "monitor-1",
        name: "API health",
      }),
    }));

    vi.doMock("@/lib/server/supabase/admin", () => ({
      createSupabaseAdminClient: () => ({}),
    }));

    const { executeManualMonitorRun } = await import("@/lib/server/monitoring/execute");

    const result = await executeManualMonitorRun(
      {
        userId: "user-1",
        organization: {
          id: "org-1",
          name: "Prod Studio",
          slug: "prod-studio",
          isActive: true,
        },
        membership: {
          id: "membership-1",
          organizationId: "org-1",
          userId: "user-1",
          role: "responder",
          createdAt: "2026-06-01T00:00:00Z",
        },
      },
      "monitor-1",
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: "result-1",
        status: "failure",
        triggerSource: "manual",
      }),
    );
    expect(persistMonitorExecutionResult).toHaveBeenCalledTimes(1);
    expect(processScheduledIncidentState).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          id: "result-1",
          status: "failure",
          triggerSource: "manual",
        }),
        monitor: expect.objectContaining({
          id: "monitor-1",
          organizationId: "org-1",
          appId: "app-1",
        }),
        suppressedByMaintenanceWindowId: null,
      }),
      expect.any(Object),
    );
  });

  it("rejects cross-org monitor access before persisting or processing incident state", async () => {
    const persistMonitorExecutionResult = vi.fn();
    const processScheduledIncidentState = vi.fn();

    vi.doMock("@/lib/server/audit/audit-log", () => ({
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("@/lib/server/incidents/incident-engine", () => ({
      processScheduledIncidentState,
    }));

    vi.doMock("@/lib/server/monitoring/evaluate", () => ({
      evaluateMonitor: vi.fn(),
    }));

    vi.doMock("@/lib/server/monitoring/result-service", () => ({
      persistMonitorExecutionResult,
    }));

    vi.doMock("@/lib/server/monitors/monitor-service", () => ({
      getRawMonitorForExecution: vi.fn().mockRejectedValue(
        Object.assign(new Error("not found"), {
          status: 404,
          code: "MONITOR_NOT_FOUND",
        }),
      ),
    }));

    vi.doMock("@/lib/server/monitors/monitor-sanitization", () => ({
      sanitizeMonitorForAudit: vi.fn(),
    }));

    vi.doMock("@/lib/server/supabase/admin", () => ({
      createSupabaseAdminClient: () => ({}),
    }));

    const { executeManualMonitorRun } = await import("@/lib/server/monitoring/execute");

    await expect(
      executeManualMonitorRun(
        {
          userId: "user-1",
          organization: {
            id: "org-1",
            name: "Prod Studio",
            slug: "prod-studio",
            isActive: true,
          },
          membership: {
            id: "membership-1",
            organizationId: "org-1",
            userId: "user-1",
            role: "responder",
            createdAt: "2026-06-01T00:00:00Z",
          },
        },
        "monitor-cross-org",
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "MONITOR_NOT_FOUND",
    });

    expect(persistMonitorExecutionResult).not.toHaveBeenCalled();
    expect(processScheduledIncidentState).not.toHaveBeenCalled();
  });
});
