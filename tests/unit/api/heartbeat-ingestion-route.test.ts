import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("heartbeat ingestion route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/server/heartbeats/heartbeat-service");
  });

  it("returns a safe not-found response for invalid tokens", async () => {
    const { ApiError } = await import("@/lib/server/api/errors");

    vi.doMock("@/lib/server/heartbeats/heartbeat-service", () => ({
      ingestHeartbeatPing: vi
        .fn()
        .mockRejectedValue(new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")),
    }));

    const { POST } = await import("@/app/api/heartbeats/[heartbeatId]/route");
    const response = await POST(
      new Request("https://example.com/api/heartbeats/missing", {
        method: "POST",
        body: "{}",
      }),
      {
        params: Promise.resolve({
          heartbeatId: "missing",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false });
  });
});
