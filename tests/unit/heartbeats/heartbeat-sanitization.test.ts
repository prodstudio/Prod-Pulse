import { describe, expect, it } from "vitest";

import { sanitizeHeartbeatPayload } from "@/lib/server/heartbeats/heartbeat-sanitization";

describe("heartbeat sanitization", () => {
  it("sanitizes unsafe payload metadata before storage", () => {
    const payload = sanitizeHeartbeatPayload({
      service: "tiquer-worker",
      environment: "production",
      jobName: "nightly-sync",
      runId: "run-123",
      status: "ok",
      message:
        "token=abc123 https://hooks.slack.com/services/T000/B000/secret postgres://user:pass@db.internal:5432/prod",
      durationMs: 1234,
      timestamp: "2026-06-01T03:00:00Z",
    });

    expect(payload).toMatchObject({
      service: "tiquer-worker",
      environment: "production",
      jobName: "nightly-sync",
      runId: "run-123",
      status: "ok",
      durationMs: 1234,
      reportedTimestamp: "2026-06-01T03:00:00.000Z",
    });
    expect(payload.message).not.toContain("abc123");
    expect(payload.message).not.toContain("hooks.slack.com/services");
    expect(payload.message).not.toContain("postgres://");
  });
});
