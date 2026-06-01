import { describe, expect, it, vi } from "vitest";

import {
  requireOrgRole,
  requireResourceAccess,
} from "@/lib/server/auth/organization-context";
import { createApp } from "@/lib/server/apps/app-service";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

function createChain(result: { data?: unknown; error?: { message: string; code?: string } }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: result.data ?? null,
      error: result.error ?? null,
    }),
    single: vi.fn().mockResolvedValue({
      data: result.data ?? null,
      error: result.error ?? null,
    }),
  };
}

describe("auth and service access control", () => {
  it("rejects cross-org resource access", async () => {
    const membershipsChain = createChain({
      data: {
        id: "membership-1",
        organization_id: "org-1",
        user_id: "user-1",
        role: "viewer",
        disabled_at: null,
        created_at: "2026-05-29T00:00:00Z",
        organizations: {
          id: "org-1",
          name: "Prod Studio",
          slug: "prod-studio",
          is_active: true,
        },
      },
    });
    const appsChain = createChain({ data: null });

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return membershipsChain;
        }

        if (table === "monitored_apps") {
          return appsChain;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      requireResourceAccess("user-1", "app", "app-1", "org-1", adminClient as never),
    ).rejects.toMatchObject({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("allows admin role checks for privileged mutations", async () => {
    const membershipsChain = createChain({
      data: [
        {
          id: "membership-1",
          organization_id: "org-1",
          user_id: "user-1",
          role: "admin",
          disabled_at: null,
          created_at: "2026-05-29T00:00:00Z",
          organizations: {
            id: "org-1",
            name: "Prod Studio",
            slug: "prod-studio",
            is_active: true,
          },
        },
      ],
    });

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return {
            ...membershipsChain,
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "membership-1",
                organization_id: "org-1",
                user_id: "user-1",
                role: "admin",
                disabled_at: null,
                created_at: "2026-05-29T00:00:00Z",
                organizations: {
                  id: "org-1",
                  name: "Prod Studio",
                  slug: "prod-studio",
                  is_active: true,
                },
              },
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      requireOrgRole("user-1", ["admin", "owner"], "org-1", adminClient as never),
    ).resolves.toMatchObject({
      membership: {
        role: "admin",
      },
    });
  });

  it("creates an app with organization context derived server-side", async () => {
    const insertChain = createChain({
      data: {
        id: "app-1",
        name: "Tiquer",
        slug: "tiquer",
        description: null,
        owner_team: "core",
        status: "unknown",
        created_at: "2026-05-29T00:00:00Z",
        updated_at: "2026-05-29T00:00:00Z",
      },
    });

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "monitored_apps") {
          return insertChain;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const app = await createApp(
      {
        userId: "user-1",
        organization: {
          id: "org-1",
          name: "Prod Studio",
          slug: "prod-studio",
          isActive: true,
        },
        membership: {
          id: "membership-1",
          organizationId: "org-1",
          userId: "user-1",
          role: "admin",
          createdAt: "2026-05-29T00:00:00Z",
        },
      },
      {
        name: "Tiquer",
        slug: "tiquer",
        ownerTeam: "core",
      },
      adminClient as never,
    );

    expect(app).toMatchObject({
      id: "app-1",
      slug: "tiquer",
    });
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        created_by: "user-1",
      }),
    );
  });
});
