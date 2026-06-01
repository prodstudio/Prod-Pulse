import { describe, expect, it } from "vitest";

import {
  maskSlackWebhookUrl,
  sanitizeProviderResponseSummary,
  sanitizeSlackText,
  toSafeNotificationChannel,
} from "@/lib/server/alerts/alert-sanitization";

describe("alert sanitization", () => {
  it("masks Slack webhook URLs for display", () => {
    const masked = maskSlackWebhookUrl(
      "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop",
    );

    expect(masked).toContain("hooks.slack.com");
    expect(masked).not.toContain("abcdefghijklmnop");
  });

  it("redacts tokens and webhook URLs from Slack text", () => {
    const value = sanitizeSlackText(
      "token=secret-value https://hooks.slack.com/services/T000/B000/abcdefghijklmnop",
    );

    expect(value).toContain("token=[redacted]");
    expect(value).not.toContain("secret-value");
    expect(value).not.toContain("abcdefghijklmnop");
  });

  it("returns safe notification channel payloads only", () => {
    const safeChannel = toSafeNotificationChannel({
      id: "channel-1",
      organizationId: "org-1",
      name: "Primary",
      type: "slack",
      isEnabled: true,
      maskedDestination: "hooks.slack.com/.../mnop",
      encryptedConfig: "secret",
      lastTestedAt: null,
      lastTestStatus: null,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    });

    expect(safeChannel).toMatchObject({
      id: "channel-1",
      maskedDestination: "hooks.slack.com/.../mnop",
    });
    expect(safeChannel).not.toHaveProperty("encryptedConfig");
  });

  it("stores only safe provider response summaries", () => {
    const response = sanitizeProviderResponseSummary({
      ok: true,
      statusCode: 200,
      bodySummary: "ok",
      raw: "ignore me",
    });

    expect(response).toEqual({
      ok: true,
      statusCode: 200,
      bodySummary: "ok",
    });
  });
});
