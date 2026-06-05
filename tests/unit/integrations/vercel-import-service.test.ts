import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  listAppsForOrganization: vi.fn(),
  createApp: vi.fn(),
  updateApp: vi.fn(),
  listEnvironmentsForApp: vi.fn(),
  createEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
  listMonitorsForOrganization: vi.fn(),
  createMonitor: vi.fn(),
  updateMonitor: vi.fn(),
}));

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

vi.mock("@/lib/server/apps/app-service", () => ({
  listAppsForOrganization: mocks.listAppsForOrganization,
  createApp: mocks.createApp,
  updateApp: mocks.updateApp,
}));

vi.mock("@/lib/server/apps/environment-service", () => ({
  listEnvironmentsForApp: mocks.listEnvironmentsForApp,
  createEnvironment: mocks.createEnvironment,
  updateEnvironment: mocks.updateEnvironment,
}));

vi.mock("@/lib/server/monitors/monitor-service", () => ({
  listMonitorsForOrganization: mocks.listMonitorsForOrganization,
  createMonitor: mocks.createMonitor,
  updateMonitor: mocks.updateMonitor,
}));

import { ApiError } from "@/lib/server/api/errors";
import {
  getVercelImportSettings,
  importVercelProject,
  listVercelProjectsForImport,
} from "@/lib/server/integrations/vercel-import-service";

function createContext(role: "owner" | "admin" | "viewer" = "owner") {
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
      role,
      createdAt: "2026-06-05T00:00:00Z",
    },
  };
}

function createFetchResponse(projects: Array<Record<string, unknown>>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      projects,
    }),
  });
}

describe("vercel import service", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.writeAuditLog.mockResolvedValue(undefined);
    process.env.VERCEL_IMPORT_TOKEN = "secret-token";
    process.env.VERCEL_IMPORT_TEAM_SLUG = "prodstudio-projects";
    delete process.env.VERCEL_IMPORT_TEAM_ID;
  });

  it("creates app, environment, and monitor from a Vercel project", async () => {
    mocks.listAppsForOrganization.mockResolvedValueOnce([]);
    mocks.createApp.mockResolvedValueOnce({
      id: "app-1",
      name: "Piem",
      slug: "piem",
      description: null,
      ownerTeam: "Vercel",
      status: "unknown",
      createdAt: "2026-06-05T00:00:00Z",
      updatedAt: "2026-06-05T00:00:00Z",
    });
    mocks.listEnvironmentsForApp.mockResolvedValueOnce([]);
    mocks.createEnvironment.mockResolvedValueOnce({
      id: "env-1",
      appId: "app-1",
      name: "Production",
      slug: "piem-production",
      type: "production",
      baseUrl: "https://piem.app",
      status: "unknown",
      createdAt: "2026-06-05T00:00:00Z",
      updatedAt: "2026-06-05T00:00:00Z",
    });
    mocks.listMonitorsForOrganization.mockResolvedValueOnce([]);
    mocks.createMonitor.mockResolvedValueOnce({
      id: "monitor-1",
      appId: "app-1",
      environmentId: "env-1",
      slug: "piem-uptime",
      name: "Piem uptime",
      type: "http",
    });

    const result = await importVercelProject(
      createContext(),
      { projectId: "prj_1" },
      createFetchResponse([
        {
          id: "prj_1",
          name: "Piem",
          alias: [{ alias: "piem.app", target: "PRODUCTION" }],
        },
      ]) as never,
    );

    expect(result.created).toEqual({
      app: true,
      environment: true,
      monitor: true,
    });
    expect(mocks.createApp).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: expect.objectContaining({ id: "org-1" }),
      }),
      expect.objectContaining({
        slug: "piem",
      }),
    );
    expect(mocks.createEnvironment).toHaveBeenCalledWith(
      expect.anything(),
      "app-1",
      expect.objectContaining({
        slug: "piem-production",
        baseUrl: "https://piem.app",
      }),
    );
    expect(mocks.createMonitor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appId: "app-1",
        environmentId: "env-1",
        slug: "piem-uptime",
        targetUrl: "https://piem.app",
      }),
    );
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          projectId: "prj_1",
        }),
      }),
    );
  });

  it("reuses existing app, environment, and monitor idempotently", async () => {
    mocks.listAppsForOrganization.mockResolvedValueOnce([
      {
        id: "app-1",
        name: "Piem",
        slug: "piem",
        description: null,
        ownerTeam: null,
        status: "unknown",
        createdAt: "2026-06-05T00:00:00Z",
        updatedAt: "2026-06-05T00:00:00Z",
      },
    ]);
    mocks.updateApp.mockResolvedValueOnce({
      id: "app-1",
      name: "Piem",
      slug: "piem",
      description: "Imported from Vercel project Piem.",
      ownerTeam: "Vercel",
      status: "unknown",
      createdAt: "2026-06-05T00:00:00Z",
      updatedAt: "2026-06-05T00:00:00Z",
    });
    mocks.listEnvironmentsForApp.mockResolvedValueOnce([
      {
        id: "env-1",
        appId: "app-1",
        name: "Production",
        slug: "piem-production",
        type: "production",
        baseUrl: "https://old.piem.app",
        status: "unknown",
        createdAt: "2026-06-05T00:00:00Z",
        updatedAt: "2026-06-05T00:00:00Z",
      },
    ]);
    mocks.updateEnvironment.mockResolvedValueOnce({
      id: "env-1",
      appId: "app-1",
      name: "Production",
      slug: "piem-production",
      type: "production",
      baseUrl: "https://piem.app",
      status: "unknown",
      createdAt: "2026-06-05T00:00:00Z",
      updatedAt: "2026-06-05T00:00:00Z",
    });
    mocks.listMonitorsForOrganization.mockResolvedValueOnce([
      {
        id: "monitor-1",
        appId: "app-1",
        environmentId: "env-1",
        slug: "piem-uptime",
        name: "Piem uptime",
        type: "http",
      },
    ]);
    mocks.updateMonitor.mockResolvedValueOnce({
      id: "monitor-1",
      appId: "app-1",
      environmentId: "env-1",
      slug: "piem-uptime",
      name: "Piem uptime",
      type: "http",
    });

    const result = await importVercelProject(
      createContext(),
      { projectId: "prj_1" },
      createFetchResponse([
        {
          id: "prj_1",
          name: "Piem",
          alias: [{ alias: "piem.app", target: "PRODUCTION" }],
        },
      ]) as never,
    );

    expect(result.created).toEqual({
      app: false,
      environment: false,
      monitor: false,
    });
    expect(mocks.createApp).not.toHaveBeenCalled();
    expect(mocks.createEnvironment).not.toHaveBeenCalled();
    expect(mocks.createMonitor).not.toHaveBeenCalled();
    expect(mocks.updateApp).toHaveBeenCalled();
    expect(mocks.updateEnvironment).toHaveBeenCalled();
    expect(mocks.updateMonitor).toHaveBeenCalled();
  });

  it("handles missing production URL safely", async () => {
    await expect(
      importVercelProject(
        createContext(),
        { projectId: "prj_1" },
        createFetchResponse([
          {
            id: "prj_1",
            name: "Piem",
            alias: [],
          },
        ]) as never,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "request_failed",
    });

    expect(mocks.createApp).not.toHaveBeenCalled();
    expect(mocks.createEnvironment).not.toHaveBeenCalled();
    expect(mocks.createMonitor).not.toHaveBeenCalled();
  });

  it("blocks unauthorized users", async () => {
    await expect(
      listVercelProjectsForImport(createContext("viewer"), createFetchResponse([]) as never),
    ).rejects.toMatchObject({
      status: 403,
      code: "ORG_ROLE_REQUIRED",
    });
  });

  it("returns only safe project data and never exposes the token", async () => {
    const projects = await listVercelProjectsForImport(
      createContext(),
      createFetchResponse([
        {
          id: "prj_1",
          name: "Piem",
          alias: [{ alias: "piem.app", target: "PRODUCTION" }],
        },
      ]) as never,
    );

    expect(projects).toEqual([
      {
        id: "prj_1",
        name: "Piem",
        slug: "piem",
        productionUrl: "https://piem.app",
        importBlockedReason: null,
      },
    ]);
    expect(JSON.stringify(projects)).not.toContain("secret-token");
    expect(getVercelImportSettings()).toEqual({
      isConfigured: true,
      teamScopeLabel: "prodstudio-projects",
    });
  });

  it("keeps org-scoped lookups tied to the current organization", async () => {
    mocks.listAppsForOrganization.mockResolvedValueOnce([]);
    mocks.createApp.mockResolvedValueOnce({
      id: "app-1",
      name: "Piem",
      slug: "piem",
      description: null,
      ownerTeam: "Vercel",
      status: "unknown",
      createdAt: "2026-06-05T00:00:00Z",
      updatedAt: "2026-06-05T00:00:00Z",
    });
    mocks.listEnvironmentsForApp.mockResolvedValueOnce([]);
    mocks.createEnvironment.mockResolvedValueOnce({
      id: "env-1",
      appId: "app-1",
      name: "Production",
      slug: "piem-production",
      type: "production",
      baseUrl: "https://piem.app",
      status: "unknown",
      createdAt: "2026-06-05T00:00:00Z",
      updatedAt: "2026-06-05T00:00:00Z",
    });
    mocks.listMonitorsForOrganization.mockResolvedValueOnce([]);
    mocks.createMonitor.mockResolvedValueOnce({
      id: "monitor-1",
      appId: "app-1",
      environmentId: "env-1",
      slug: "piem-uptime",
      name: "Piem uptime",
      type: "http",
    });

    await importVercelProject(
      createContext(),
      { projectId: "prj_1" },
      createFetchResponse([
        {
          id: "prj_1",
          name: "Piem",
          alias: [{ alias: "piem.app", target: "PRODUCTION" }],
        },
      ]) as never,
    );

    expect(mocks.listAppsForOrganization).toHaveBeenCalledWith("org-1");
    expect(mocks.listEnvironmentsForApp).toHaveBeenCalledWith("org-1", "app-1");
    expect(mocks.listMonitorsForOrganization).toHaveBeenCalledWith("org-1");
  });
});
