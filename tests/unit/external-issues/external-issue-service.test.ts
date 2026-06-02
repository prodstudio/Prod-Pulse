import { describe, expect, it, vi } from "vitest";

import {
  createAndLinkExternalIssueReference,
  linkExternalIssueToIncident,
  listLinkedExternalIssuesForIncident,
  unlinkExternalIssueFromIncident,
  upsertExternalIssueReference,
} from "@/lib/server/external-issues/external-issue-service";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

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
      createdAt: "2026-06-02T00:00:00Z",
    },
  };
}

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
        created_at: "2026-06-02T00:00:00Z",
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

function createIncidentResourceChain(organizationId = "org-1") {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "incident-1",
        organization_id: organizationId,
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
      },
      error: null,
    }),
  };
}

function createExternalIssueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    organization_id: "org-1",
    integration_id: null,
    source_kind: "ciex",
    external_id: "ticket-123",
    external_key: "CIEX-123",
    title: "Customer cannot sign in",
    status: "open",
    priority: "high",
    source_url: "https://ciex.example.com/tickets/123",
    customer_reference: "Acme Corp",
    summary: "Customer reports repeated auth failures.",
    created_by: "user-1",
    created_at: "2026-06-02T00:00:00Z",
    updated_at: "2026-06-02T00:01:00Z",
    ...overrides,
  };
}

function createExternalIssueLookupChain(result: { data: unknown; error: null }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

function createExternalIssueListChain(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: rows,
      error: null,
    }),
  };
}

describe("external issue service", () => {
  it("upserts duplicate external issues instead of creating a second row", async () => {
    let externalIssueCalls = 0;
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return createMembershipChain();
        }
        if (table === "external_issues") {
          externalIssueCalls += 1;
          if (externalIssueCalls === 1) {
            return createExternalIssueLookupChain({
              data: createExternalIssueRow(),
              error: null,
            });
          }
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: createExternalIssueRow({ title: "Updated ticket title" }),
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const issue = await upsertExternalIssueReference(
      createContext(),
      {
        sourceKind: "ciex",
        externalId: "ticket-123",
        externalKey: "CIEX-123",
        title: "Updated ticket title",
        status: "open",
        priority: "high",
        sourceUrl: "https://ciex.example.com/tickets/123",
        customerReference: "Acme Corp",
        summary: "Updated summary",
      },
      adminClient as never,
    );

    expect(issue.title).toBe("Updated ticket title");
    expect(adminClient.from).not.toHaveBeenCalledWith("incident_external_issues");
  });

  it("creates and links a manual CIEX reference to an incident", async () => {
    let externalIssueCalls = 0;
    let incidentExternalIssueCalls = 0;
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return createMembershipChain();
        }
        if (table === "incidents") {
          return createIncidentResourceChain();
        }
        if (table === "external_issues") {
          externalIssueCalls += 1;
          if (externalIssueCalls === 1) {
            return createExternalIssueLookupChain({ data: null, error: null });
          }
          if (externalIssueCalls === 2) {
            return {
              insert: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: createExternalIssueRow(),
                error: null,
              }),
            };
          }
          if (externalIssueCalls === 3) {
            return createExternalIssueLookupChain({
              data: createExternalIssueRow(),
              error: null,
            });
          }
          return createExternalIssueListChain([createExternalIssueRow()]);
        }
        if (table === "incident_external_issues") {
          incidentExternalIssueCalls += 1;
          if (incidentExternalIssueCalls === 1) {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ external_issue_id: "issue-1", created_at: "2026-06-02T00:02:00Z" }],
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const linked = await createAndLinkExternalIssueReference(
      createContext(),
      "incident-1",
      {
        sourceKind: "ciex",
        externalId: "ticket-123",
        externalKey: "CIEX-123",
        title: "Customer cannot sign in",
        status: "open",
        priority: "high",
        sourceUrl: "https://ciex.example.com/tickets/123",
        customerReference: "Acme Corp",
        summary: "Customer reports repeated auth failures.",
      },
      adminClient as never,
    );

    expect(linked).toEqual([
      expect.objectContaining({
        id: "issue-1",
        sourceKind: "ciex",
        externalId: "ticket-123",
      }),
    ]);
  });

  it("rejects cross-org linking attempts", async () => {
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return createMembershipChain();
        }
        if (table === "incidents") {
          return createIncidentResourceChain();
        }
        if (table === "external_issues") {
          return createExternalIssueLookupChain({
            data: null,
            error: null,
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      linkExternalIssueToIncident(
        createContext(),
        "incident-1",
        "issue-cross-org",
        adminClient as never,
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("lists and unlinks external issues through org-scoped lookups", async () => {
    let externalIssueCalls = 0;
    let incidentExternalIssueCalls = 0;
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return createMembershipChain();
        }
        if (table === "incidents") {
          return createIncidentResourceChain();
        }
        if (table === "incident_external_issues") {
          incidentExternalIssueCalls += 1;
          if (incidentExternalIssueCalls === 2) {
            const deleteChain = {
              delete: vi.fn(),
              eq: vi.fn(),
            };
            deleteChain.delete.mockReturnValue(deleteChain);
            deleteChain.eq.mockReturnValue(deleteChain);
            return deleteChain;
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ external_issue_id: "issue-1", created_at: "2026-06-02T00:02:00Z" }],
              error: null,
            }),
          };
        }
        if (table === "external_issues") {
          externalIssueCalls += 1;
          if (externalIssueCalls === 1) {
            return createExternalIssueListChain([createExternalIssueRow()]);
          }
          if (externalIssueCalls === 2) {
            return createExternalIssueLookupChain({
              data: createExternalIssueRow(),
              error: null,
            });
          }
          return createExternalIssueListChain([createExternalIssueRow()]);
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const listed = await listLinkedExternalIssuesForIncident(
      "user-1",
      "incident-1",
      "org-1",
      adminClient as never,
    );
    expect(listed).toHaveLength(1);

    const unlinked = await unlinkExternalIssueFromIncident(
      createContext(),
      "incident-1",
      "issue-1",
      adminClient as never,
    );
    expect(unlinked).toHaveLength(1);
  });
});
