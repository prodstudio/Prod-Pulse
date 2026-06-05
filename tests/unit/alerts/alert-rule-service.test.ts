import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/server/auth/organization-context", () => ({
  requireOrgMembership: vi.fn().mockResolvedValue({
    organization: {
      id: "org-1",
      name: "Prod Studio",
      slug: "prod",
      isActive: true,
    },
    membership: {
      id: "membership-1",
      organizationId: "org-1",
      userId: "user-1",
      role: "owner",
      createdAt: "2026-06-04T00:00:00Z",
    },
  }),
  requireResourceAccess: vi.fn().mockImplementation(
    async (
      userId: string,
      resourceKind: "app" | "monitor",
      resourceId: string,
      organizationId?: string,
    ) => ({
      organizationContext: {
        organization: {
          id: organizationId ?? "org-1",
          name: "Prod Studio",
          slug: "prod",
          isActive: true,
        },
        membership: {
          id: "membership-1",
          organizationId: organizationId ?? "org-1",
          userId,
          role: "owner",
          createdAt: "2026-06-04T00:00:00Z",
        },
      },
      resource:
        resourceKind === "monitor"
          ? {
              id: resourceId,
              organization_id: organizationId ?? "org-1",
              app_id: "11111111-1111-4111-8111-111111111111",
            }
          : {
              id: resourceId,
              organization_id: organizationId ?? "org-1",
            },
    }),
  ),
}));

import {
  createAlertRule,
  createAlertRuleSchema,
} from "@/lib/server/alerts/alert-rule-service";

function createContext() {
  return {
    userId: "user-1",
    organization: {
      id: "org-1",
      name: "Prod Studio",
      slug: "prod",
      isActive: true,
    },
    membership: {
      id: "membership-1",
      organizationId: "org-1",
      userId: "user-1",
      role: "owner" as const,
      createdAt: "2026-06-04T00:00:00Z",
    },
  };
}

function createAdminClient() {
  let insertedPayload: Record<string, unknown> | null = null;

  const adminClient = {
    from: vi.fn((table: string) => {
      if (table === "notification_channels") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [{ id: "33333333-3333-4333-8333-333333333333" }],
            error: null,
          }),
        };
      }

      if (table === "alert_rules") {
        const chain = {
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertedPayload = payload;
            return chain;
          }),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: "rule-1",
              organization_id: "org-1",
              app_id: "11111111-1111-4111-8111-111111111111",
              monitor_id: "22222222-2222-4222-8222-222222222222",
              name: "Primary alerts",
              is_enabled: true,
              severity_filter: ["warning", "critical", "emergency"],
              send_recovery: true,
              notify_on_degraded: true,
              dedupe_window_seconds: 120,
              max_retry_attempts: 5,
              backoff_strategy: "exponential",
              configuration: {
                eventTypes: ["incident_created", "incident_recovered"],
                notificationChannelIds: ["channel-1"],
              },
              created_at: "2026-06-04T00:00:00Z",
              updated_at: "2026-06-04T00:00:00Z",
            },
            error: null,
          }),
        };

        return chain;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    adminClient,
    getInsertedPayload: () => insertedPayload,
  };
}

describe("alert rule service", () => {
  it("writes severity_filter as a Postgres enum-array literal", async () => {
    const state = createAdminClient();

    await createAlertRule(
      createContext(),
      createAlertRuleSchema.parse({
        name: "Primary alerts",
        appId: "11111111-1111-4111-8111-111111111111",
        monitorId: "22222222-2222-4222-8222-222222222222",
        isEnabled: true,
        severityFilter: ["warning", "critical", "emergency"],
        sendRecovery: true,
        notifyOnDegraded: true,
        dedupeWindowSeconds: 120,
        maxRetryAttempts: 5,
        backoffStrategy: "exponential",
        eventTypes: ["incident_created", "incident_recovered"],
        notificationChannelIds: ["33333333-3333-4333-8333-333333333333"],
      }),
      state.adminClient as never,
    );

    expect(state.getInsertedPayload()).toMatchObject({
      severity_filter: "{warning,critical,emergency}",
      configuration: {
        eventTypes: ["incident_created", "incident_recovered"],
        notificationChannelIds: ["33333333-3333-4333-8333-333333333333"],
      },
    });
  });
});
