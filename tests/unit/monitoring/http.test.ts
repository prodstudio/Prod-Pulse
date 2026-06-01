import { describe, expect, it, vi } from "vitest";

import { executeHttpRequest } from "@/lib/server/monitoring/http";

describe("executeHttpRequest", () => {
  it("records a successful HTTP response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await executeHttpRequest({
      targetUrl: "https://example.com/health",
      requestMethod: "GET",
      timeoutMs: 1000,
      fetchImpl,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.responseJson).toEqual({ ok: true });
    expect(result.attempts).toHaveLength(1);
    expect(result.errorCode).toBeNull();
  });

  it("retries once on 5xx responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream issue", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await executeHttpRequest({
      targetUrl: "https://example.com/health",
      requestMethod: "GET",
      timeoutMs: 1000,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.httpStatus).toBe(200);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.httpStatus).toBe(503);
  });

  it("returns a timeout result when both attempts abort", async () => {
    const abortError = Object.assign(new Error("The operation was aborted."), {
      name: "AbortError",
    });
    const fetchImpl = vi.fn().mockRejectedValue(abortError);

    const result = await executeHttpRequest({
      targetUrl: "https://example.com/health",
      requestMethod: "GET",
      timeoutMs: 1000,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.errorCode).toBe("REQUEST_TIMEOUT");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1]?.status).toBe("timeout");
  });

  it("keeps the timeout active while reading the response body", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: () =>
        new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("The operation was aborted."), {
                name: "AbortError",
              }),
            );
          });
        }),
    }));

    const result = await executeHttpRequest({
      targetUrl: "https://example.com/health",
      requestMethod: "GET",
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.errorCode).toBe("REQUEST_TIMEOUT");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((attempt) => attempt.status === "timeout")).toBe(true);
  });
});
