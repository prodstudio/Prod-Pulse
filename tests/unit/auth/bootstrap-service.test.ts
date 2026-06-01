import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import {
  bootstrapInitialOwner,
  getBootstrapAvailability,
  hasAnyActiveMemberships,
} from "@/lib/server/auth/bootstrap-service";

function createMembershipQuery(rows: Array<Record<string, unknown>>) {
  return {
    select: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: rows,
      error: null,
    }),
  };
}

describe("bootstrap service", () => {
  beforeEach(() => {
    delete process.env.INITIAL_OWNER_BOOTSTRAP_TOKEN;
  });

  it("detects existing active memberships", async () => {
    const adminClient = {
      from: vi.fn(() => createMembershipQuery([{ id: "membership-1" }])),
    };

    await expect(hasAnyActiveMemberships(adminClient as never)).resolves.toBe(true);
  });

  it("reports bootstrap available only when token exists and no memberships exist", async () => {
    process.env.INITIAL_OWNER_BOOTSTRAP_TOKEN = "bootstrap-secret";

    const adminClient = {
      from: vi.fn(() => createMembershipQuery([])),
    };

    await expect(getBootstrapAvailability(adminClient as never)).resolves.toBe("available");
  });

  it("blocks bootstrap after memberships already exist", async () => {
    process.env.INITIAL_OWNER_BOOTSTRAP_TOKEN = "bootstrap-secret";

    const adminClient = {
      from: vi.fn(() => createMembershipQuery([{ id: "membership-1" }])),
      rpc: vi.fn(),
    };

    await expect(
      bootstrapInitialOwner({
        user: {
          id: "user-1",
          email: "ops@prod.studio",
          fullName: "Ops User",
          avatarUrl: null,
        },
        organizationName: "Prod Studio",
        organizationSlug: "prod-studio",
        bootstrapToken: "bootstrap-secret",
        adminClient: adminClient as never,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });

  it("blocks bootstrap with an invalid token", async () => {
    process.env.INITIAL_OWNER_BOOTSTRAP_TOKEN = "bootstrap-secret";

    const adminClient = {
      from: vi.fn(() => createMembershipQuery([])),
      rpc: vi.fn(),
    };

    await expect(
      bootstrapInitialOwner({
        user: {
          id: "user-1",
          email: "ops@prod.studio",
          fullName: "Ops User",
          avatarUrl: null,
        },
        organizationName: "Prod Studio",
        organizationSlug: "prod-studio",
        bootstrapToken: "wrong-secret",
        adminClient: adminClient as never,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });

  it("bootstraps the first owner through the atomic rpc path", async () => {
    process.env.INITIAL_OWNER_BOOTSTRAP_TOKEN = "bootstrap-secret";

    const adminClient = {
      from: vi.fn(() => createMembershipQuery([])),
      rpc: vi.fn().mockResolvedValue({
        data: [{ organization_id: "org-1" }],
        error: null,
      }),
    };

    await expect(
      bootstrapInitialOwner({
        user: {
          id: "user-1",
          email: "ops@prod.studio",
          fullName: "Ops User",
          avatarUrl: null,
        },
        organizationName: "Prod Studio",
        organizationSlug: "Prod Studio",
        bootstrapToken: "bootstrap-secret",
        adminClient: adminClient as never,
      }),
    ).resolves.toMatchObject({
      organizationId: "org-1",
    });

    expect(adminClient.rpc).toHaveBeenCalledWith(
      "bootstrap_initial_owner",
      expect.objectContaining({
        target_user_id: "user-1",
        organization_slug: "prod-studio",
      }),
    );
  });
});
