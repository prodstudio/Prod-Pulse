import { describe, expect, it } from "vitest";

import {
  generateHeartbeatToken,
  hashHeartbeatToken,
  verifyHeartbeatToken,
} from "@/lib/server/heartbeats/heartbeat-token";

describe("heartbeat token helpers", () => {
  it("generates a high-entropy token and stores only its hash", () => {
    const generated = generateHeartbeatToken();

    expect(generated.rawToken).toHaveLength(43);
    expect(generated.tokenHash).not.toBe(generated.rawToken);
    expect(generated.tokenHint).toMatch(/^\.\.\.[A-Za-z0-9_-]{6}$/);
    expect(hashHeartbeatToken(generated.rawToken)).toBe(generated.tokenHash);
  });

  it("accepts valid tokens and rejects invalid ones", () => {
    const generated = generateHeartbeatToken();

    expect(verifyHeartbeatToken(generated.rawToken, generated.tokenHash)).toBe(true);
    expect(
      verifyHeartbeatToken(`${generated.rawToken}-wrong`, generated.tokenHash),
    ).toBe(false);
  });
});
