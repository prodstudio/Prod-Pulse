import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

vi.mock("@/lib/server/supabase/client", () => ({
  hasSupabaseServerEnv: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/server/auth/organization-context", () => ({
  getActiveOrganizationForUser: vi.fn(),
}));

import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/server/supabase/client";
import { getActiveOrganizationForUser } from "@/lib/server/auth/organization-context";
import {
  getCurrentUser,
  requireAppSession,
  requireAuthenticatedUser,
} from "@/lib/server/auth/guards";

describe("auth guards", () => {
  it("returns null current user when Supabase env is missing", async () => {
    vi.mocked(hasSupabaseServerEnv).mockReturnValue(false);

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("redirects unauthenticated users to login", async () => {
    vi.mocked(hasSupabaseServerEnv).mockReturnValue(true);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);

    await expect(requireAuthenticatedUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("returns a safe no-org app session when membership is missing", async () => {
    vi.mocked(hasSupabaseServerEnv).mockReturnValue(true);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "ops@prod.studio",
            },
          },
        }),
      },
    } as never);
    vi.mocked(getActiveOrganizationForUser).mockResolvedValue(null);

    await expect(requireAppSession()).resolves.toMatchObject({
      user: {
        id: "user-1",
        email: "ops@prod.studio",
      },
      organizationContext: null,
    });
  });
});
