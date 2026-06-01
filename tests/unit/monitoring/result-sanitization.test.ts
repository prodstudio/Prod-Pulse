import { describe, expect, it } from "vitest";

import {
  sanitizeResultMetadata,
  sanitizeStoredResponseExcerpt,
} from "@/lib/server/monitoring/result-sanitization";

describe("monitor result sanitization", () => {
  it("removes tokens, authorization values, and cookies from excerpts", () => {
    const excerpt = sanitizeStoredResponseExcerpt(
      "Authorization=Bearer super-secret cookie=session=abc123 https://user:pass@example.com/health?token=secret",
    );

    expect(excerpt).not.toContain("super-secret");
    expect(excerpt).not.toContain("abc123");
    expect(excerpt).not.toContain("pass");
    expect(excerpt).toContain("[redacted]");
  });

  it("removes webhook URLs, database URLs, and JSON secret values from excerpts", () => {
    const excerpt = sanitizeStoredResponseExcerpt(
      '{"webhookUrl":"https://hooks.slack.com/services/T000/B000/secret","databaseUrl":"postgres://user:pass@db.internal:5432/prod","token":"abc123"}',
    );

    expect(excerpt).not.toContain("hooks.slack.com/services/T000/B000/secret");
    expect(excerpt).not.toContain("postgres://user:pass@db.internal:5432/prod");
    expect(excerpt).not.toContain("abc123");
    expect(excerpt).toContain("[redacted]");
  });

  it("omits raw html and stack traces from excerpts", () => {
    expect(sanitizeStoredResponseExcerpt("<!DOCTYPE html><html><body>500</body></html>")).toBe(
      "HTML response omitted.",
    );

    expect(
      sanitizeStoredResponseExcerpt(
        "Error: database password leaked\n    at run (/app/server.ts:12:3)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
      ),
    ).toBe("Error response omitted.");
  });

  it("redacts sensitive metadata keys and nested values", () => {
    const metadata = sanitizeResultMetadata({
      authorization: "Bearer secret",
      cookieHeader: "session=abc123",
      nested: {
        token: "secret-token",
        safe: "ok",
      },
    });

    expect(JSON.stringify(metadata)).not.toContain("secret-token");
    expect(JSON.stringify(metadata)).not.toContain("abc123");
    expect(metadata.authorization).toBe("[redacted]");
    expect(metadata.nested).toEqual({
      token: "[redacted]",
      safe: "ok",
    });
  });
});
