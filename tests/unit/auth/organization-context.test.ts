import { describe, expect, it } from "vitest";

import { requireResourceAccess } from "@/lib/server/auth/organization-context";

function createAdminClientForResource(resource: Record<string, unknown>) {
  const state = {
    membershipSelect: "",
    resourceSelect: "",
  };

  const membershipChain = {
    select: (value: string) => {
      state.membershipSelect = value;
      return membershipChain;
    },
    eq: () => membershipChain,
    is: () => membershipChain,
    maybeSingle: async () => ({
      data: {
        id: "membership-1",
        organization_id: "org-1",
        user_id: "user-1",
        role: "owner",
        disabled_at: null,
        created_at: "2026-06-05T00:00:00Z",
        organizations: {
          id: "org-1",
          name: "Prod Studio",
          slug: "prod",
          is_active: true,
        },
      },
      error: null,
    }),
  };

  const resourceChain = {
    select: (value: string) => {
      state.resourceSelect = value;
      return resourceChain;
    },
    eq: () => resourceChain,
    maybeSingle: async () => ({
      data: resource,
      error: null,
    }),
  };

  const adminClient = {
    from: (table: string) => {
      if (table === "memberships") {
        return membershipChain;
      }

      if (table === "monitored_apps" || table === "app_environments") {
        return resourceChain;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    adminClient,
    state,
  };
}

describe("organization context resource access", () => {
  it("uses monitored_app columns that exist when validating app access", async () => {
    const { adminClient, state } = createAdminClientForResource({
      id: "app-1",
      organization_id: "org-1",
      name: "Piem",
      slug: "piem",
    });

    await requireResourceAccess("user-1", "app", "app-1", "org-1", adminClient as never);

    expect(state.resourceSelect).toBe("id, organization_id, name, slug");
  });

  it("uses app_environment columns that exist when validating environment access", async () => {
    const { adminClient, state } = createAdminClientForResource({
      id: "env-1",
      organization_id: "org-1",
      app_id: "app-1",
      name: "Production",
      slug: "piem-production",
    });

    await requireResourceAccess(
      "user-1",
      "environment",
      "env-1",
      "org-1",
      adminClient as never,
    );

    expect(state.resourceSelect).toBe("id, organization_id, app_id, name, slug");
  });
});
