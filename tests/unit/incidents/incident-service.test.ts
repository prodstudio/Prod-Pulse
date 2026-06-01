import { describe, expect, it, vi } from "vitest";

import {
  acknowledgeIncident,
  createUserIncidentUpdate,
} from "@/lib/server/incidents/incident-service";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

function createMembershipChain() {
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

function createIncidentResourceChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "incident-1",
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
      },
      error: null,
    }),
  };
}

function createIncidentLookupChain(status: string) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "incident-1",
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
        created_from_result_id: "result-1",
        title: "API health is down",
        summary: "The endpoint responded with HTTP 503.",
        severity: "critical",
        status,
        dedupe_key: "primary_failure",
        assigned_to: null,
        opened_by: null,
        detected_at: "2026-06-01T00:00:00Z",
        opened_at: status === "detected" ? null : "2026-06-01T00:01:00Z",
        acknowledged_at: null,
        recovered_at: null,
        resolved_at: status === "resolved" ? "2026-06-01T00:10:00Z" : null,
        auto_resolve_on_recovery: false,
        root_cause: null,
        resolution_notes: null,
        last_state_change_at: "2026-06-01T00:01:00Z",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:01:00Z",
      },
      error: null,
    }),
  };
}

function createContext() {
  return {
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
}

describe("incident service", () => {
  it("does not allow acknowledging a resolved incident", async () => {
    let incidentCalls = 0;
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return createMembershipChain();
        }

        if (table === "incidents") {
          incidentCalls += 1;
          return incidentCalls === 1
            ? createIncidentResourceChain()
            : createIncidentLookupChain("resolved");
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      acknowledgeIncident(createContext(), "incident-1", adminClient as never),
    ).rejects.toMatchObject({
      status: 409,
      code: "INCIDENT_ALREADY_RESOLVED",
    });
  });

  it("blocks invalid lifecycle transitions from open directly to monitoring", async () => {
    let incidentCalls = 0;
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return createMembershipChain();
        }

        if (table === "incidents") {
          incidentCalls += 1;
          return incidentCalls === 1
            ? createIncidentResourceChain()
            : createIncidentLookupChain("open");
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      createUserIncidentUpdate(
        createContext(),
        "incident-1",
        {
          statusTo: "monitoring",
          message: "Trying to skip investigating.",
        },
        adminClient as never,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "INVALID_INCIDENT_TRANSITION",
    });
  });
});
