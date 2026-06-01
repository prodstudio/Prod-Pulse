import "server-only";

import tls from "node:tls";

type SslCheckAttempt = {
  attemptNumber: number;
  status: "success" | "failure" | "timeout" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export type SslCheckResult = {
  status: "success" | "degraded" | "failure" | "timeout" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
  daysUntilExpiry: number | null;
  expiresAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: SslCheckAttempt[];
};

type ExecuteSslExpiryCheckInput = {
  targetUrl: string;
  timeoutMs: number;
  warningDays?: number;
};

function buildAttempt(
  attemptNumber: number,
  startedAt: Date,
  finishedAt: Date,
  status: SslCheckAttempt["status"],
  errorCode: string | null,
  errorMessage: string | null,
): SslCheckAttempt {
  return {
    attemptNumber,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    errorCode,
    errorMessage,
  };
}

function getDaysUntilExpiry(expiresAt: Date, now = new Date()) {
  return Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);
}

async function checkCertificate(
  targetUrl: string,
  timeoutMs: number,
): Promise<{
  startedAt: Date;
  finishedAt: Date;
  expiresAt: string;
  daysUntilExpiry: number;
}> {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("SSL checks require an https target.");
  }

  return new Promise((resolve, reject) => {
    const startedAt = new Date();
    const socket = tls.connect(
      {
        host: parsed.hostname,
        port: Number(parsed.port || 443),
        servername: parsed.hostname,
        rejectUnauthorized: false,
      },
      () => {
        const certificate = socket.getPeerCertificate();
        const finishedAt = new Date();

        if (!certificate || !certificate.valid_to) {
          socket.end();
          reject(new Error("No SSL certificate was returned by the endpoint."));
          return;
        }

        const expiresAt = new Date(certificate.valid_to);
        socket.end();

        resolve({
          startedAt,
          finishedAt,
          expiresAt: expiresAt.toISOString(),
          daysUntilExpiry: getDaysUntilExpiry(expiresAt),
        });
      },
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error("SSL timeout"));
    });

    socket.on("error", (error: Error) => {
      reject(error);
    });
  });
}

export async function executeSslExpiryCheck({
  targetUrl,
  timeoutMs,
  warningDays = 30,
}: ExecuteSslExpiryCheckInput): Promise<SslCheckResult> {
  const attempts: SslCheckAttempt[] = [];

  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    try {
      const certificateResult = await checkCertificate(targetUrl, timeoutMs);
      attempts.push(
        buildAttempt(
          attemptNumber,
          certificateResult.startedAt,
          certificateResult.finishedAt,
          "success",
          null,
          null,
        ),
      );

      return {
        status:
          certificateResult.daysUntilExpiry < 0
            ? "failure"
            : certificateResult.daysUntilExpiry <= warningDays
              ? "degraded"
              : "success",
        startedAt: certificateResult.startedAt.toISOString(),
        finishedAt: certificateResult.finishedAt.toISOString(),
        durationMs: Math.max(
          0,
          certificateResult.finishedAt.getTime() - certificateResult.startedAt.getTime(),
        ),
        daysUntilExpiry: certificateResult.daysUntilExpiry,
        expiresAt: certificateResult.expiresAt,
        errorCode: null,
        errorMessage: null,
        attempts,
      };
    } catch (error) {
      const startedAt = new Date();
      const finishedAt = new Date();
      const isTimeout =
        error instanceof Error && /timeout/i.test(error.message);
      const errorCode = isTimeout ? "SSL_TIMEOUT" : "SSL_CHECK_FAILED";
      const errorMessage = isTimeout
        ? "The SSL certificate check timed out."
        : "The SSL certificate could not be inspected.";

      attempts.push(
        buildAttempt(
          attemptNumber,
          startedAt,
          finishedAt,
          isTimeout ? "timeout" : "error",
          errorCode,
          errorMessage,
        ),
      );

      if (!isTimeout || attemptNumber === 2) {
        return {
          status: isTimeout ? "timeout" : "error",
          startedAt: attempts[0]?.startedAt ?? startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: 0,
          daysUntilExpiry: null,
          expiresAt: null,
          errorCode,
          errorMessage,
          attempts,
        };
      }
    }
  }

  const now = new Date().toISOString();
  return {
    status: "error",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    daysUntilExpiry: null,
    expiresAt: null,
    errorCode: "SSL_CHECK_FAILED",
    errorMessage: "The SSL certificate could not be inspected.",
    attempts,
  };
}
