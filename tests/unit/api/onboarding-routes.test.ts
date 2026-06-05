import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("onboarding creation routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.doUnmock("@/lib/server/auth/guards");
    vi.doUnmock("@/lib/server/auth/organization-context");
  });

  function mockViewerMembership() {
    vi.doMock("@/lib/server/auth/guards", () => ({
      requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
    }));
    vi.doMock("@/lib/server/auth/organization-context", () => ({
      requireOrgMembership: vi.fn().mockResolvedValue({
        organization: { id: "org-1", name: "Prod Studio", slug: "prod", isActive: true },
        membership: {
          id: "membership-1",
          organizationId: "org-1",
          userId: "user-1",
          role: "viewer",
          createdAt: "2026-06-05T00:00:00Z",
        },
      }),
    }));
  }

  it("blocks viewer app creation", async () => {
    mockViewerMembership();

    const { POST } = await import("@/app/api/apps/route");
    const response = await POST(
      new Request("https://example.com/api/apps", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "You do not have permission to perform this action.",
      },
    });
  });

  it("blocks viewer environment creation", async () => {
    mockViewerMembership();

    const { POST } = await import("@/app/api/apps/[appId]/environments/route");
    const response = await POST(
      new Request("https://example.com/api/apps/app-1/environments", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      {
        params: Promise.resolve({ appId: "app-1" }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "You do not have permission to perform this action.",
      },
    });
  });

  it("blocks viewer monitor creation", async () => {
    mockViewerMembership();

    const { POST } = await import("@/app/api/monitors/route");
    const response = await POST(
      new Request("https://example.com/api/monitors", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "You do not have permission to perform this action.",
      },
    });
  });
});
