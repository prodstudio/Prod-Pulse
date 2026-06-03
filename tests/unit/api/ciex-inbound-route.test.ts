import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  ingest: vi.fn(),
}));

vi.mock("@/lib/server/integrations/ciex-inbound-service", async () => {
  return {
    ciexInboundPayloadSchema: {
      parse: mocks.parse,
    },
    ingestCiexInboundIssue: mocks.ingest,
  };
});

import { ApiError } from "@/lib/server/api/errors";
import { POST } from "@/app/api/integrations/ciex/inbound/route";

describe("ciex inbound route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.parse.mockReset();
    mocks.ingest.mockReset();
  });

  it("returns a safe unauthorized response for invalid integration auth", async () => {
    mocks.parse.mockImplementation((value) => value);
    mocks.ingest.mockRejectedValue(
      new ApiError(401, "unauthorized", "Authentication required."),
    );

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

  it("returns a safe validation response for malformed payloads", async () => {
    mocks.parse.mockImplementation(() => {
      throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed.", {
        issues: {
          fieldErrors: {
            externalId: ["External issue id is required."],
          },
          formErrors: [],
        },
      });
    });

    const response = await POST(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ externalId: "" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "Request validation failed.",
        details: {
          issues: {
            fieldErrors: {
              externalId: ["External issue id is required."],
            },
            formErrors: [],
          },
        },
      },
    });
  });
});
