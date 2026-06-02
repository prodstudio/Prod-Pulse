import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ciex inbound route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.doUnmock("@/lib/server/integrations/ciex-inbound-service");
  });

  it("returns a safe unauthorized response for invalid integration auth", async () => {
    vi.doMock("@/lib/server/integrations/ciex-inbound-service", async () => {
      const { ApiError } = await import("@/lib/server/api/errors");

      return {
        ciexInboundPayloadSchema: { parse: vi.fn((value) => value) },
        ingestCiexInboundIssue: vi.fn().mockRejectedValue(
          new ApiError(401, "unauthorized", "Authentication required."),
        ),
      };
    });

    const { POST } = await import("@/app/api/integrations/ciex/inbound/route");
    const response = await POST(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({
          ticket: {
            externalId: "ticket-123",
            title: "Customer cannot sign in",
          },
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication required.",
      },
    });
  });
});
