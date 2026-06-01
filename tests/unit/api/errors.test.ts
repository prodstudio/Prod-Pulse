import { describe, expect, it } from "vitest";

import {
  ApiError,
  createErrorResponse,
  getActionErrorRedirectValue,
  mapPostgresError,
} from "@/lib/server/api/errors";

describe("api error handling", async () => {
  it("returns a generic client-safe message for unexpected errors", async () => {
    const response = createErrorResponse(new Error("database password leaked"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "unexpected_error",
        message: "Something went wrong. Please try again.",
      },
    });
  });

  it("does not forward raw postgres messages to clients", async () => {
    const response = createErrorResponse(
      mapPostgresError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "secret_idx"',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: "conflict",
        message: "A record with these details already exists.",
      },
    });
  });

  it("keeps validation details for safe client handling", async () => {
    const response = createErrorResponse(
      new ApiError(400, "validation_failed", "Request validation failed.", {
        issues: {
          fieldErrors: {
            slug: ["Invalid slug"],
          },
        },
      }),
    );
    const body = await response.json();

    expect(body).toEqual({
      error: {
        code: "validation_failed",
        message: "Request validation failed.",
        details: {
          issues: {
            fieldErrors: {
              slug: ["Invalid slug"],
            },
          },
        },
      },
    });
  });

  it("does not propagate raw exception text into action redirect params", () => {
    expect(getActionErrorRedirectValue(new Error("database password leaked"))).toBe(
      "unexpected_error",
    );
    expect(
      getActionErrorRedirectValue(
        new ApiError(400, "validation_failed", "Request validation failed."),
      ),
    ).toBe("validation_failed");
  });
});
