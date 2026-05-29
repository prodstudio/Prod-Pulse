import { describe, expect, it } from "vitest";

import { createHealthResponse } from "@/lib/health/create-health-response";
import { validateHealthResponse } from "@/lib/health/validate-health-response";

describe("validateHealthResponse", () => {
  it("accepts a valid response", () => {
    const response = createHealthResponse({
      status: "ok",
      service: "tiquer",
      environment: "production",
      version: "1.0.0",
      commit: "abc123",
      checks: {
        database: { status: "ok", latencyMs: 42 },
        auth: { status: "ok" },
      },
    });

    expect(validateHealthResponse(response)).toEqual({
      success: true,
      data: response,
      errors: [],
    });
  });

  it("accepts a degraded response", () => {
    const response = createHealthResponse({
      status: "degraded",
      service: "gama",
      environment: "staging",
      checks: {
        database: { status: "ok" },
        external: {
          stripe: "degraded",
        },
      },
    });

    expect(validateHealthResponse(response).success).toBe(true);
  });

  it("accepts a down response", () => {
    const response = createHealthResponse({
      status: "down",
      service: "dent-hail",
      environment: "production",
      checks: {
        database: { status: "down" },
      },
    });

    expect(validateHealthResponse(response).success).toBe(true);
  });

  it("rejects malformed responses", () => {
    const result = validateHealthResponse({
      status: "ok",
      service: "tiquer",
      environment: "production",
      timestamp: "not-a-date",
      checks: ["database"],
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects stale timestamps when maxAgeMs is configured", () => {
    const response = createHealthResponse({
      status: "ok",
      service: "tiquer",
      environment: "production",
      timestamp: "2026-05-29T14:00:00Z",
      checks: {
        database: { status: "ok" },
      },
    });

    const result = validateHealthResponse(response, {
      maxAgeMs: 1_000,
      now: new Date("2026-05-29T14:00:05Z"),
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("timestamp is older than the allowed maxAgeMs");
  });

  it("rejects responses missing a required check", () => {
    const response = createHealthResponse({
      status: "ok",
      service: "tiquer",
      environment: "production",
      checks: {
        database: { status: "ok" },
      },
    });

    const result = validateHealthResponse(response, {
      requiredChecks: ["database", "auth"],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("missing required check: auth");
  });
});
