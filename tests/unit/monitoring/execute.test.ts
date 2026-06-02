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
    vi.doUnmock("@/lib/server/monitoring/evaluate");
    vi.doUnmock("@/lib/server/monitoring/result-service");
    vi.doUnmock("@/lib/server/monitors/monitor-service");
    vi.doUnmock("@/lib/server/supabase/admin");
  });

  it("does not queue alert deliveries during a manual run", async () => {
    const tablesSeen: string[] = [];

    vi.doMock("@/lib/server/audit/audit-log", () => ({
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("@/lib/server/monitoring/evaluate", () => ({
      evaluateMonitor: vi.fn().mockResolvedValue({
        status: "success",
        checkedAt: "2026-06-01T00:00:00Z",
        startedAt: "2026-06-01T00:00:00Z",
        finishedAt: "2026-06-01T00:00:01Z",
        durationMs: 1000,
        httpStatus: 200,
        errorCode: null,
        errorMessage: null,
        responseExcerpt: null,
        assertionResults: {},
        metadata: {},
        attempts: [],
      }),
    }));

    vi.doMock("@/lib/server/monitoring/result-service", () => ({
      persistMonitorExecutionResult: vi.fn().mockResolvedValue({
        id: "result-1",
        status: "success",
        checkedAt: "2026-06-01T00:00:00Z",
        httpStatus: 200,
        errorCode: null,
      }),
    }));

    vi.doMock("@/lib/server/monitors/monitor-service", () => ({
      getRawMonitorForExecution: vi.fn().mockResolvedValue({
        id: "monitor-1",
        organizationId: "org-1",
        name: "API health",
        configuration: {},
      }),
    }));

    vi.doMock("@/lib/server/supabase/admin", () => ({
      createSupabaseAdminClient: () => ({
        from: (table: string) => {
          tablesSeen.push(table);
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        },
      }),
    }));

    const { executeManualMonitorRun } = await import("@/lib/server/monitoring/execute");

    await executeManualMonitorRun(
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

    expect(tablesSeen).not.toContain("alert_deliveries");
  });
});
