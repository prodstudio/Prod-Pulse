import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

vi.mock("@/lib/server/supabase/client", () => ({
  hasSupabaseServerEnv: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/server/auth/bootstrap-service", () => ({
  bootstrapInitialOwner: vi.fn(),
  syncProfileFromAuthIdentity: vi.fn().mockResolvedValue(undefined),
}));

import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/server/supabase/client";
import {
  bootstrapInitialOwner,
  syncProfileFromAuthIdentity,
} from "@/lib/server/auth/bootstrap-service";
import {
  bootstrapInitialOwnerAction,
  signOutAction,
  signInWithPasswordAction,
} from "@/lib/server/auth/actions";

describe("auth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasSupabaseServerEnv).mockReturnValue(true);
  });

  it("rejects invalid login payloads before hitting Supabase", async () => {
    const formData = new FormData();
    formData.set("email", "not-an-email");
    formData.set("password", "");

    await expect(signInWithPasswordAction(formData)).rejects.toThrow(
      "REDIRECT:/login?error=validation_failed",
    );

    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("does not propagate an unsafe next redirect on failed login", async () => {
    const formData = new FormData();
    formData.set("email", "ops@prod.studio");
    formData.set("password", "password");
    formData.set("next", "https://evil.example");

    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "Invalid login credentials" },
        }),
      },
    } as never);

    await expect(signInWithPasswordAction(formData)).rejects.toThrow(
      "REDIRECT:/login?error=unauthorized&next=%2Fdashboard",
    );
  });

  it("signs in successfully and redirects to a sanitized next target", async () => {
    const formData = new FormData();
    formData.set("email", "ops@prod.studio");
    formData.set("password", "password");
    formData.set("next", "/monitors");

    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "ops@prod.studio",
              user_metadata: {
                full_name: "Ops User",
              },
            },
          },
          error: null,
        }),
      },
    } as never);

    await expect(signInWithPasswordAction(formData)).rejects.toThrow("REDIRECT:/monitors");
    expect(syncProfileFromAuthIdentity).toHaveBeenCalled();
  });

  it("rejects invalid bootstrap payloads before calling the bootstrap service", async () => {
    const formData = new FormData();
    formData.set("organizationName", "P");
    formData.set("organizationSlug", "");
    formData.set("bootstrapToken", "");

    await expect(bootstrapInitialOwnerAction(formData)).rejects.toThrow(
      "REDIRECT:/dashboard?error=validation_failed",
    );

    expect(bootstrapInitialOwner).not.toHaveBeenCalled();
  });

  it("signs out and redirects to the signed-out login state", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        signOut,
      },
    } as never);

    await expect(signOutAction()).rejects.toThrow("REDIRECT:/login?status=signed_out");
    expect(signOut).toHaveBeenCalled();
  });

  it("does not leak logout runtime failures", async () => {
    vi.mocked(createSupabaseServerClient).mockRejectedValue(new Error("supabase outage"));

    await expect(signOutAction()).rejects.toThrow("REDIRECT:/dashboard?error=request_failed");
  });
});
