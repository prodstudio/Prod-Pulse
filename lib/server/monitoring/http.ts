import "server-only";

export type HttpAttempt = {
  attemptNumber: number;
  status: "success" | "failure" | "timeout" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type HttpExecutionResult = {
  attempts: HttpAttempt[];
  responseText: string | null;
  responseJson: unknown;
  httpStatus: number | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  contentType: string | null;
};

type ExecuteHttpRequestInput = {
  targetUrl: string;
  requestMethod: string;
  timeoutMs: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
};

function isValidHttpUrl(targetUrl: string) {
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isRetriableStatus(httpStatus: number | null) {
  return typeof httpStatus === "number" && httpStatus >= 500;
}

function buildAttempt(
  attemptNumber: number,
  startedAt: Date,
  finishedAt: Date,
  status: HttpAttempt["status"],
  httpStatus: number | null,
  errorCode: string | null,
  errorMessage: string | null,
): HttpAttempt {
  return {
    attemptNumber,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    httpStatus,
    errorCode,
    errorMessage,
  };
}

export async function executeHttpRequest({
  targetUrl,
  requestMethod,
  timeoutMs,
  maxAttempts = 2,
  fetchImpl = fetch,
}: ExecuteHttpRequestInput): Promise<HttpExecutionResult> {
  if (!isValidHttpUrl(targetUrl)) {
    const now = new Date();

    return {
      attempts: [
        buildAttempt(
          1,
          now,
          now,
          "failure",
          null,
          "INVALID_URL",
          "The configured target URL is invalid.",
        ),
      ],
      responseText: null,
      responseJson: null,
      httpStatus: null,
      durationMs: 0,
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      errorCode: "INVALID_URL",
      errorMessage: "The configured target URL is invalid.",
      contentType: null,
    };
  }

  const attempts: HttpAttempt[] = [];

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const startedAt = new Date();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(targetUrl, {
        method: requestMethod,
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
      });
      const responseText = await response.text();
      const finishedAt = new Date();
      clearTimeout(timeout);
      const httpStatus = response.status;
      const contentType = response.headers.get("content-type");
      const attemptStatus: HttpAttempt["status"] = response.ok ? "success" : "failure";
      attempts.push(
        buildAttempt(attemptNumber, startedAt, finishedAt, attemptStatus, httpStatus, null, null),
      );

      if (isRetriableStatus(httpStatus) && attemptNumber < maxAttempts) {
        continue;
      }

      let responseJson: unknown = null;
      if (contentType?.includes("application/json")) {
        try {
          responseJson = JSON.parse(responseText);
        } catch {
          responseJson = null;
        }
      }

      return {
        attempts,
        responseText,
        responseJson,
        httpStatus,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        startedAt: attempts[0]?.startedAt ?? startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        errorCode: response.ok ? null : `HTTP_${httpStatus}`,
        errorMessage: response.ok
          ? null
          : `The endpoint responded with HTTP ${httpStatus}.`,
        contentType,
      };
    } catch (error) {
      const finishedAt = new Date();
      clearTimeout(timeout);

      const isTimeout =
        error instanceof Error &&
        (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));
      const errorCode = isTimeout ? "REQUEST_TIMEOUT" : "NETWORK_ERROR";
      const errorMessage = isTimeout
        ? "The request timed out."
        : "The request could not be completed due to a network error.";

      attempts.push(
        buildAttempt(
          attemptNumber,
          startedAt,
          finishedAt,
          isTimeout ? "timeout" : "error",
          null,
          errorCode,
          errorMessage,
        ),
      );

      if (attemptNumber < maxAttempts) {
        continue;
      }

      return {
        attempts,
        responseText: null,
        responseJson: null,
        httpStatus: null,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        startedAt: attempts[0]?.startedAt ?? startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        errorCode,
        errorMessage,
        contentType: null,
      };
    }
  }

  const fallbackTime = new Date().toISOString();
  return {
    attempts,
    responseText: null,
    responseJson: null,
    httpStatus: null,
    durationMs: null,
    startedAt: fallbackTime,
    finishedAt: fallbackTime,
    errorCode: "REQUEST_FAILED",
    errorMessage: "The request could not be completed.",
    contentType: null,
  };
}
