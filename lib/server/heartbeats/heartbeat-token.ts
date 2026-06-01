import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const HEARTBEAT_TOKEN_BYTES = 32;

export function hashHeartbeatToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function buildHeartbeatTokenHint(token: string) {
  const tail = token.slice(-6);
  return tail ? `...${tail}` : null;
}

export function generateHeartbeatToken() {
  const rawToken = randomBytes(HEARTBEAT_TOKEN_BYTES).toString("base64url");

  return {
    rawToken,
    tokenHash: hashHeartbeatToken(rawToken),
    tokenHint: buildHeartbeatTokenHint(rawToken),
  };
}

export function verifyHeartbeatToken(token: string, tokenHash: string) {
  const computed = Buffer.from(hashHeartbeatToken(token), "utf8");
  const expected = Buffer.from(tokenHash, "utf8");

  if (computed.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(computed, expected);
}
