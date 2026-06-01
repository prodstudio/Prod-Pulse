import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { ApiError } from "@/lib/server/api/errors";

const ENCRYPTION_VERSION = "v1";
const IV_LENGTH = 12;

type EncryptedPayload = {
  version: typeof ENCRYPTION_VERSION;
  iv: string;
  tag: string;
  ciphertext: string;
};

function requireEncryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;

  if (!raw) {
    throw new ApiError(500, "request_failed", "The request could not be completed.");
  }

  return createHash("sha256").update(raw).digest();
}

function encode(payload: EncryptedPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decode(value: string): EncryptedPayload {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<EncryptedPayload>;

    if (
      parsed.version !== ENCRYPTION_VERSION ||
      typeof parsed.iv !== "string" ||
      typeof parsed.tag !== "string" ||
      typeof parsed.ciphertext !== "string"
    ) {
      throw new Error("Invalid encrypted payload");
    }

    return parsed as EncryptedPayload;
  } catch {
    throw new ApiError(500, "request_failed", "The request could not be completed.");
  }
}

export function encryptAlertConfig(input: Record<string, unknown>) {
  const key = requireEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(input), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return encode({
    version: ENCRYPTION_VERSION,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}

export function decryptAlertConfig<T extends Record<string, unknown>>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }

  const payload = decode(value);
  const key = requireEncryptionKey();

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64url")),
      decipher.final(),
    ]);

    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new ApiError(500, "request_failed", "The request could not be completed.");
  }
}
