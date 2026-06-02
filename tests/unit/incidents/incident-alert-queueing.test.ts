import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("incident alert queueing hooks", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/server/audit/audit-log");
    vi.doUnmock("@/lib/server/alerts/alert-engine");
    vi.doUnmock("@/lib/server/external-issues/external-issue-service");
  });

  it("queues incident_created when the incident engine creates an incident", async () => {
    vi.doMock("@/lib/server/audit/audit-log", () => ({
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
    }));

    const queueIncidentAlertDeliveries = vi.fn().mockResolvedValue({
      queuedCount: 1,
      duplicateCount: 0,
      skippedCount: 0,
    });
    vi.doMock("@/lib/server/alerts/alert-engine", () => ({
      queueIncidentAlertDeliveries,
    }));
    vi.doMock("@/lib/server/external-issues/external-issue-service", () => ({
      listLinkedExternalIssuesForIncident: vi.fn().mockResolvedValue([]),
    }));

    const { processScheduledIncidentState } = await import(
      "@/lib/server/incidents/incident-engine"
    );

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "monitor_results") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                { id: "result-1", status: "failure" },
                { id: "result-0", status: "failure" },
                { id: "result--1", status: "failure" },
              ],
              error: null,
            }),
          };
        }
        if (table === "incidents") {
          const callCount = adminClient.from.mock.calls.filter(
            ([name]) => name === "incidents",
          ).length;
          if (callCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "incident-1",
                organization_id: "org-1",
                app_id: "app-1",
                environment_id: "env-1",
                monitor_id: "monitor-1",
                created_from_result_id: "result-1",
                title: "API health is down",
                summary: "HTTP 503",
                severity: "critical",
                status: "detected",
                dedupe_key: "primary_failure",
                assigned_to: null,
                opened_by: null,
                detected_at: "2026-06-01T00:00:00Z",
                opened_at: null,
                acknowledged_at: null,
                recovered_at: null,
                resolved_at: null,
                auto_resolve_on_recovery: false,
                root_cause: null,
                resolution_notes: null,
                last_state_change_at: "2026-06-01T00:00:00Z",
                created_at: "2026-06-01T00:00:00Z",
                updated_at: "2026-06-01T00:00:00Z",
              },
              error: null,
            }),
          };
        }
        if (table === "incident_updates") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "incident_external_issues") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "external_issues") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await processScheduledIncidentState(
      {
        monitor: {
          id: "monitor-1",
          organizationId: "org-1",
          appId: "app-1",
          environmentId: "env-1",
          name: "API health",
          slug: "api-health",
          type: "http",
          status: "down",
          isEnabled: true,
          requestMethod: "GET",
          targetUrl: "https://example.com/health",
          expectedStatusCodes: [200],
          intervalSeconds: 300,
          nextCheckAt: "2026-06-01T00:00:00Z",
          timeoutMs: 10000,
          latencyThresholdMs: null,
          consecutiveFailureThreshold: 3,
          consecutiveRecoveryThreshold: 2,
          consecutiveFailures: 2,
          consecutiveSuccesses: 0,
          configuration: {},
          description: null,
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
          lastCheckedAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastScheduledBucket: null,
          lockedAt: null,
          lockExpiresAt: null,
          lockedByRunId: null,
        },
        result: {
          id: "result-1",
          status: "failure",
          triggerSource: "scheduled",
          checkedAt: "2026-06-01T00:00:00Z",
          durationMs: 1000,
          httpStatus: 503,
          errorCode: "HTTP_503",
          errorSummary: "HTTP 503",
          responseSummary: null,
          assertionSummary: null,
          metadataSummary: null,
        },
      },
      adminClient as never,
    );

    expect(queueIncidentAlertDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "incident_created",
      }),
      adminClient,
    );
  }, 15000);

  it("queues acknowledged and resolved user incident events", async () => {
    vi.doMock("@/lib/server/audit/audit-log", () => ({
      writeAuditLog: vi.fn().mockResolvedValue(undefined),
    }));

    const queueIncidentAlertDeliveries = vi.fn().mockResolvedValue({
      queuedCount: 1,
      duplicateCount: 0,
      skippedCount: 0,
    });
    vi.doMock("@/lib/server/alerts/alert-engine", () => ({
      queueIncidentAlertDeliveries,
    }));
    vi.doMock("@/lib/server/external-issues/external-issue-service", () => ({
      listLinkedExternalIssuesForIncident: vi.fn().mockResolvedValue([]),
    }));

    const { acknowledgeIncident, resolveIncident } = await import(
      "@/lib/server/incidents/incident-service"
    );

    const baseIncident = {
      id: "incident-1",
      organization_id: "org-1",
      app_id: "app-1",
      environment_id: "env-1",
      monitor_id: "monitor-1",
      created_from_result_id: "result-1",
      title: "API health is down",
      summary: "HTTP 503",
      severity: "critical",
      dedupe_key: "primary_failure",
      assigned_to: null,
      opened_by: null,
      detected_at: "2026-06-01T00:00:00Z",
      auto_resolve_on_recovery: false,
      root_cause: null,
      resolution_notes: null,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:01:00Z",
    };
    const incidentMaybeSingleResponses = [
      {
        id: "incident-1",
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
      },
      {
        ...baseIncident,
        status: "open",
        opened_at: "2026-06-01T00:01:00Z",
        acknowledged_at: null,
        recovered_at: null,
        resolved_at: null,
        last_state_change_at: "2026-06-01T00:01:00Z",
      },
      {
        id: "incident-1",
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
      },
      {
        ...baseIncident,
        status: "acknowledged",
        opened_at: "2026-06-01T00:01:00Z",
        acknowledged_at: "2026-06-01T00:02:00Z",
        recovered_at: null,
        resolved_at: null,
        last_state_change_at: "2026-06-01T00:02:00Z",
      },
      {
        id: "incident-1",
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
      },
      {
        ...baseIncident,
        status: "acknowledged",
        opened_at: "2026-06-01T00:01:00Z",
        acknowledged_at: "2026-06-01T00:02:00Z",
        recovered_at: null,
        resolved_at: null,
        last_state_change_at: "2026-06-01T00:02:00Z",
      },
      {
        id: "incident-1",
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
      },
      {
        ...baseIncident,
        status: "resolved",
        opened_at: "2026-06-01T00:01:00Z",
        acknowledged_at: "2026-06-01T00:02:00Z",
        recovered_at: "2026-06-01T00:03:00Z",
        resolved_at: "2026-06-01T00:03:00Z",
        last_state_change_at: "2026-06-01T00:03:00Z",
      },
    ];
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "membership-1",
                organization_id: "org-1",
                user_id: "user-1",
                role: "responder",
                disabled_at: null,
                created_at: "2026-06-01T00:00:00Z",
                organizations: {
                  id: "org-1",
                  name: "Prod Studio",
                  slug: "prod-studio",
                  is_active: true,
                },
              },
              error: null,
            }),
          };
        }
        if (table === "incidents") {
          const updateChain = {
            update: vi.fn(),
            eq: vi.fn(),
          };
          updateChain.update.mockReturnValue(updateChain);
          updateChain.eq.mockImplementation(() => {
            if (updateChain.eq.mock.calls.length >= 2) {
              return Promise.resolve({ error: null });
            }

            return updateChain;
          });

          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockImplementation(async () => {
              return {
                data: incidentMaybeSingleResponses.shift() ?? null,
                error: null,
              };
            }),
            update: updateChain.update,
            single: vi.fn().mockResolvedValue({ data: incidentMaybeSingleResponses[0] ?? null, error: null }),
          };
        }
        if (table === "incident_updates") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "monitor_results") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "monitored_apps") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "app_environments") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "monitors") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "incident_external_issues") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "external_issues") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const context = {
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
        role: "responder" as const,
        createdAt: "2026-06-01T00:00:00Z",
      },
    };

    await acknowledgeIncident(context, "incident-1", adminClient as never);
    await resolveIncident(
      context,
      "incident-1",
      {
        message: "Resolved",
        rootCause: "bad config",
        resolutionNotes: "rolled back",
      },
      adminClient as never,
    );

    expect(queueIncidentAlertDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "incident_acknowledged" }),
      adminClient,
    );
    expect(queueIncidentAlertDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "incident_resolved" }),
      adminClient,
    );
  }, 15000);
});
