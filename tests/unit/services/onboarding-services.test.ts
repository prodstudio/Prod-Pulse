import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/server/api/errors";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const requireResourceAccess = vi.fn();

vi.mock("@/lib/server/auth/organization-context", () => ({
  requireResourceAccess: (...args: unknown[]) => requireResourceAccess(...args),
}));

import { createApp } from "@/lib/server/apps/app-service";
import { createEnvironment } from "@/lib/server/apps/environment-service";
import { createMonitor } from "@/lib/server/monitors/monitor-service";

function createContext() {
  return {
    userId: "user-1",
    organization: {
      id: "org-1",
      name: "Prod Studio",
      slug: "prod",
      isActive: true,
    },
    membership: {
      id: "membership-1",
      organizationId: "org-1",
      userId: "user-1",
      role: "owner" as const,
      createdAt: "2026-06-05T00:00:00Z",
    },
  };
}

function createSingleInsertChain(data: Record<string, unknown>) {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data,
      error: null,
    }),
  };

  return chain;
}

describe("onboarding service creation", () => {
  beforeEach(() => {
    requireResourceAccess.mockReset();
  });

  it("creates an app with organization context derived server-side", async () => {
    const insertChain = createSingleInsertChain({
      id: "app-1",
      name: "Piem",
      slug: "piem",
      description: "Primary customer portal",
      owner_team: "Operations",
      status: "unknown",
      created_at: "2026-06-05T00:00:00Z",
      updated_at: "2026-06-05T00:00:00Z",
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
      createContext(),
      {
        name: "Piem",
        slug: "piem",
        description: "Primary customer portal",
        ownerTeam: "Operations",
        status: "unknown",
      },
      adminClient as never,
    );

    expect(app).toMatchObject({
      id: "app-1",
      slug: "piem",
    });
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        created_by: "user-1",
      }),
    );
  });

  it("creates an environment for an app in the same organization", async () => {
    requireResourceAccess.mockResolvedValueOnce({
      resource: {
        id: "app-1",
        organization_id: "org-1",
      },
    });

    const insertChain = createSingleInsertChain({
      id: "env-1",
      app_id: "app-1",
      name: "Production",
      slug: "piem-production",
      type: "production",
      base_url: "https://piem.app",
      status: "unknown",
      created_at: "2026-06-05T00:00:00Z",
      updated_at: "2026-06-05T00:00:00Z",
    });
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "app_environments") {
          return insertChain;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const environment = await createEnvironment(
      createContext(),
      "app-1",
      {
        name: "Production",
        slug: "piem-production",
        type: "production",
        baseUrl: "https://piem.app",
        status: "unknown",
      },
      adminClient as never,
    );

    expect(environment).toMatchObject({
      id: "env-1",
      appId: "app-1",
      slug: "piem-production",
    });
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        app_id: "app-1",
        created_by: "user-1",
      }),
    );
  });

  it("creates a monitor for an app and environment in the same organization", async () => {
    requireResourceAccess
      .mockResolvedValueOnce({
        resource: {
          id: "app-1",
          organization_id: "org-1",
        },
      })
      .mockResolvedValueOnce({
        resource: {
          id: "env-1",
          organization_id: "org-1",
          app_id: "app-1",
        },
      });

    const insertChain = createSingleInsertChain({
      id: "monitor-1",
      organization_id: "org-1",
      app_id: "app-1",
      environment_id: "env-1",
      name: "Piem homepage",
      slug: "piem-homepage",
      type: "http_uptime",
      status: "unknown",
      is_enabled: true,
      request_method: "GET",
      target_url: "https://piem.app",
      expected_status_codes: [200],
      interval_seconds: 300,
      next_check_at: "2026-06-05T00:00:00Z",
      timeout_ms: 10000,
      latency_threshold_ms: null,
      consecutive_failure_threshold: 3,
      consecutive_recovery_threshold: 2,
      configuration: {},
      description: null,
      created_at: "2026-06-05T00:00:00Z",
      updated_at: "2026-06-05T00:00:00Z",
    });
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "monitors") {
          return insertChain;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const monitor = await createMonitor(
      createContext(),
      {
        appId: "app-1",
        environmentId: "env-1",
        name: "Piem homepage",
        slug: "piem-homepage",
        type: "http",
        targetUrl: "https://piem.app",
      },
      adminClient as never,
    );

    expect(monitor).toMatchObject({
      id: "monitor-1",
      appId: "app-1",
      environmentId: "env-1",
      type: "http",
    });
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        created_by: "user-1",
      }),
    );
  });

  it("rejects environment creation when the app is outside the org scope", async () => {
    requireResourceAccess.mockRejectedValueOnce(
      new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found."),
    );

    const adminClient = {
      from: vi.fn(),
    };

    await expect(
      createEnvironment(
        createContext(),
        "foreign-app",
        {
          name: "Production",
          slug: "foreign-production",
          type: "production",
        },
        adminClient as never,
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("rejects monitor creation when the environment is outside the org scope", async () => {
    requireResourceAccess
      .mockResolvedValueOnce({
        resource: {
          id: "app-1",
          organization_id: "org-1",
        },
      })
      .mockRejectedValueOnce(
        new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found."),
      );

    const adminClient = {
      from: vi.fn(),
    };

    await expect(
      createMonitor(
        createContext(),
        {
          appId: "app-1",
          environmentId: "foreign-env",
          name: "Piem homepage",
          slug: "piem-homepage",
          type: "http",
          targetUrl: "https://piem.app",
        },
        adminClient as never,
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
    });
  });
});
