import "server-only";

import { ApiError } from "@/lib/server/api/errors";
import {
  sanitizeProviderResponseSummary,
  sanitizeSlackSummary,
} from "@/lib/server/alerts/alert-sanitization";

type SendSlackNotificationInput = {
  webhookUrl: string;
  text: string;
  timeoutMs?: number;
};

export type SlackProviderResult = {
  providerResponse: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 8_000;

export async function sendSlackNotification(
  input: SendSlackNotificationInput,
): Promise<SlackProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(input.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        text: input.text,
      }),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    const bodySummary = sanitizeSlackSummary(rawBody);

    if (!response.ok) {
      throw new ApiError(400, "request_failed", "The request could not be completed.", {
        statusCode: response.status,
      });
    }

    return {
      providerResponse: sanitizeProviderResponseSummary({
        ok: response.ok,
        statusCode: response.status,
        bodySummary,
      }),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(400, "request_failed", "The request could not be completed.");
    }

    throw new ApiError(400, "request_failed", "The request could not be completed.");
  } finally {
    clearTimeout(timeout);
  }
}
