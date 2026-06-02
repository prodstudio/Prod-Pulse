import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("proxy auth redirects", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock("@supabase/ssr");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  function createRequest(url: string) {
    const requestUrl = new URL(url);

    return {
      url,
      nextUrl: requestUrl,
      cookies: {
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn(),
      },
    };
  }

  it("redirects signed-out protected requests to login with a safe next value", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const createServerClient = vi.fn().mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
        }),
      },
    });

    vi.doMock("@supabase/ssr", () => ({
      createServerClient,
    }));

    const { proxy } = await import("../../../proxy");
    const response = await proxy(createRequest("https://prod-pulse.vercel.app/monitors?tab=history") as never);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://prod-pulse.vercel.app/login?next=%2Fmonitors%3Ftab%3Dhistory",
    );
  });

  it("redirects authenticated users away from login using a sanitized next target", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const createServerClient = vi.fn().mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
    });

    vi.doMock("@supabase/ssr", () => ({
      createServerClient,
    }));

    const { proxy } = await import("../../../proxy");
    const response = await proxy(
      createRequest("https://prod-pulse.vercel.app/login?next=https://evil.example") as never,
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://prod-pulse.vercel.app/dashboard");
  });
});
