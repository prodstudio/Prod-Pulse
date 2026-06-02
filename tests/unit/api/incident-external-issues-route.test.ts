import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("incident external issues routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/server/auth/guards");
    vi.doUnmock("@/lib/server/auth/organization-context");
    vi.doUnmock("@/lib/server/external-issues/external-issue-service");
  });

  it("returns a safe forbidden response when a viewer tries to link an issue", async () => {
    vi.doMock("@/lib/server/auth/guards", () => ({
      requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
    }));
    vi.doMock("@/lib/server/auth/organization-context", () => ({
      requireOrgMembership: vi.fn().mockResolvedValue({
        organization: { id: "org-1", name: "Prod Studio", slug: "prod-studio", isActive: true },
        membership: {
          id: "membership-1",
          organizationId: "org-1",
          userId: "user-1",
          role: "viewer",
          createdAt: "2026-06-02T00:00:00Z",
        },
      }),
    }));
    vi.doMock("@/lib/server/external-issues/external-issue-service", () => ({
      listLinkedExternalIssuesForIncident: vi.fn(),
      createAndLinkExternalIssueReference: vi.fn(),
      createExternalIssueReferenceSchema: { parse: vi.fn((value) => value) },
    }));

    const { POST } = await import("@/app/api/incidents/[incidentId]/external-issues/route");
    const response = await POST(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({
          sourceKind: "ciex",
          externalId: "ticket-123",
          title: "Customer cannot sign in",
        }),
      }),
      {
        params: Promise.resolve({ incidentId: "incident-1" }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "You do not have permission to perform this action.",
      },
    });
  }, 15000);
});
