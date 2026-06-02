import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const errorMocks = vi.hoisted(() => {
  class TestApiError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }

  return { ApiError: TestApiError };
});

vi.mock("@/lib/server/api/errors", () => {
  function normalizeErrorCode(error: InstanceType<typeof errorMocks.ApiError>) {
    if (error.code === "ORG_ROLE_REQUIRED" || error.status === 403) {
      return "forbidden";
    }
    if (error.status === 401) {
      return "unauthorized";
    }
    if (error.status === 404) {
      return "not_found";
    }
    if (error.status === 409) {
      return "conflict";
    }
    return "unexpected_error";
  }

  return {
    ApiError: errorMocks.ApiError,
    createErrorResponse: vi.fn((error: unknown) => {
      if (error instanceof errorMocks.ApiError) {
        const code = normalizeErrorCode(error);
        const message =
          code === "forbidden"
            ? "You do not have permission to perform this action."
            : code === "unauthorized"
              ? "Authentication required."
              : code === "not_found"
                ? "The requested resource was not found."
                : code === "conflict"
                  ? "A record with these details already exists."
                  : "Something went wrong. Please try again.";

        return Response.json({ error: { code, message } }, { status: error.status });
      }

      return Response.json(
        {
          error: {
            code: "unexpected_error",
            message: "Something went wrong. Please try again.",
          },
        },
        { status: 500 },
      );
    }),
  };
});

function createOrganizationContext(role: "viewer" | "responder" | "admin" | "owner") {
  return {
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
      role,
      createdAt: "2026-06-02T00:00:00Z",
    },
  };
}

describe("ciex config routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/server/auth/guards");
    vi.doUnmock("@/lib/server/auth/organization-context");
    vi.doUnmock("@/lib/server/integrations/ciex-config-service");
  });

  it("returns only safe config data on GET", async () => {
    const requireUser = vi.fn().mockResolvedValue({ id: "user-1" });
    const requireOrgMembership = vi.fn().mockResolvedValue(createOrganizationContext("admin"));
    const getCiexIntegrationConfigForOrganization = vi.fn().mockResolvedValue({
      id: "integration-1",
      kind: "ciex",
      name: "CIEX",
      isEnabled: true,
      inboundKeyHint: "****abc123",
      lastInboundAt: "2026-06-02T00:00:00Z",
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
    vi.doMock("@/lib/server/auth/guards", () => ({ requireUser }));
    vi.doMock("@/lib/server/auth/organization-context", () => ({ requireOrgMembership }));
    vi.doMock("@/lib/server/integrations/ciex-config-service", () => ({
      getCiexIntegrationConfigForOrganization,
      createCiexIntegration: vi.fn(),
    }));

    const { GET } = await import("@/app/api/integrations/ciex/route");
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.inboundKeyHint).toBe("****abc123");
    expect(payload.data.inboundKeyHash).toBeUndefined();
    expect(payload.secret).toBeUndefined();
  });

  it("rejects viewer create attempts safely", async () => {
    const requireUser = vi.fn().mockResolvedValue({ id: "user-1" });
    const requireOrgMembership = vi.fn().mockResolvedValue(createOrganizationContext("viewer"));
    const createCiexIntegration = vi.fn().mockRejectedValue(
      new errorMocks.ApiError(
        403,
        "ORG_ROLE_REQUIRED",
        "This action requires admin or owner access.",
      ),
    );
    vi.doMock("@/lib/server/auth/guards", () => ({ requireUser }));
    vi.doMock("@/lib/server/auth/organization-context", () => ({ requireOrgMembership }));
    vi.doMock("@/lib/server/integrations/ciex-config-service", () => ({
      getCiexIntegrationConfigForOrganization: vi.fn(),
      createCiexIntegration,
    }));

    const { POST } = await import("@/app/api/integrations/ciex/route");
    const response = await POST(new Request("https://example.com", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "You do not have permission to perform this action.",
      },
    });
  });

  it("returns plaintext only once on rotate and rejects responder mutation safely", async () => {
    const requireUser = vi.fn().mockResolvedValue({ id: "user-1" });
    const requireOrgMembership = vi.fn().mockResolvedValue(createOrganizationContext("admin"));
    const rotateCiexIntegrationKey = vi.fn().mockResolvedValue({
      integration: {
        id: "integration-1",
        kind: "ciex",
        name: "CIEX",
        isEnabled: true,
        inboundKeyHint: "****xyz987",
        lastInboundAt: null,
        createdAt: "2026-06-02T00:00:00Z",
        updatedAt: "2026-06-02T00:10:00Z",
      },
      plaintextSecret: "generated-secret",
    });
    vi.doMock("@/lib/server/auth/guards", () => ({ requireUser }));
    vi.doMock("@/lib/server/auth/organization-context", () => ({ requireOrgMembership }));
    vi.doMock("@/lib/server/integrations/ciex-config-service", () => ({
      rotateCiexIntegrationKey,
    }));

    const rotateModule = await import("@/app/api/integrations/ciex/rotate/route");
    const okResponse = await rotateModule.POST(new Request("https://example.com", { method: "POST" }));
    const okPayload = await okResponse.json();

    expect(okResponse.status).toBe(200);
    expect(okPayload.secret).toBe("generated-secret");
    expect(okPayload.data.inboundKeyHash).toBeUndefined();
  });

  it("rejects responder rotate attempts safely", async () => {
    const requireUser = vi.fn().mockResolvedValue({ id: "user-1" });
    const requireOrgMembership = vi.fn().mockResolvedValue(createOrganizationContext("responder"));
    vi.doMock("@/lib/server/auth/guards", () => ({ requireUser }));
    vi.doMock("@/lib/server/auth/organization-context", () => ({ requireOrgMembership }));
    vi.doMock("@/lib/server/integrations/ciex-config-service", () => ({
      rotateCiexIntegrationKey: vi.fn().mockRejectedValue(
        new errorMocks.ApiError(
          403,
          "ORG_ROLE_REQUIRED",
          "This action requires admin or owner access.",
        ),
      ),
    }));

    const forbiddenModule = await import("@/app/api/integrations/ciex/rotate/route");
    const forbidden = await forbiddenModule.POST(new Request("https://example.com", { method: "POST" }));

    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: {
        code: "forbidden",
        message: "You do not have permission to perform this action.",
      },
    });
  });
});
