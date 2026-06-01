import { describe, expect, it, vi, afterEach } from "vitest";

import { ApiError } from "@/lib/server/api/errors";
import {
  createStatusPageComponent,
} from "@/lib/server/status-pages/status-page-service";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/server/auth/organization-context", () => ({
  requireOrgMembership: vi.fn().mockResolvedValue({
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
      createdAt: "2026-06-01T00:00:00Z",
    },
  }),
  requireResourceAccess: vi.fn(async (_userId: string, resourceKind: string, resourceId: string) => {
    if (resourceKind === "status_page") {
      return {
        organizationContext: {
          organization: { id: "org-1" },
        },
        resource: {
          id: resourceId,
          organization_id: "org-1",
          name: "Ops",
          slug: "ops",
        },
      };
    }

    if (resourceKind === "status_page_component") {
      return {
        organizationContext: {
          organization: { id: "org-1" },
        },
        resource: {
          id: resourceId,
          organization_id: "org-1",
          status_page_id: "page-1",
          monitored_app_id: "app-1",
          environment_id: "env-1",
          monitor_id: "monitor-1",
        },
      };
    }

    throw new Error(`Unexpected resource kind: ${resourceKind}`);
  }),
}));

vi.mock("@/lib/server/apps/app-service", () => ({
  getAppById: vi.fn(async (_userId: string, appId: string) => ({
    id: appId,
    name: "Tiquer",
    slug: "tiquer",
    description: null,
    ownerTeam: null,
    status: "operational",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  })),
  listAppsForOrganization: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/server/apps/environment-service", () => ({
  getEnvironmentById: vi.fn(async (_userId: string, environmentId: string) => ({
    id: environmentId,
    appId: "app-1",
    name: "Production",
    slug: "production",
    type: "production",
    baseUrl: null,
    status: "operational",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  })),
  listEnvironmentsForApp: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/server/monitors/monitor-service", () => ({
  getMonitorById: vi.fn(async (_userId: string, monitorId: string) => ({
    id: monitorId,
    appId: "app-1",
    environmentId: "env-1",
    name: "API health",
    slug: "api-health",
    type: "api_health",
    status: "operational",
    isEnabled: true,
    requestMethod: "GET",
    targetSummary: "https://api.example.com/health",
    expectedStatusCodes: [200],
    intervalSeconds: 300,
    nextCheckAt: null,
    timeoutMs: 10000,
    latencyThresholdMs: null,
    consecutiveFailureThreshold: 3,
    consecutiveRecoveryThreshold: 2,
    description: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    hasStoredConfiguration: false,
    configurationSummary: null,
  })),
  listMonitorsForOrganization: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/server/incidents/incident-service", () => ({
  listIncidentsForOrganization: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/server/heartbeats/heartbeat-service", () => ({
  getHeartbeatByMonitorId: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/server/monitoring/result-service", () => ({
  listMonitorResultsForMonitor: vi.fn().mockResolvedValue([]),
}));

function createContext() {
  return {
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
      role: "admin" as const,
      createdAt: "2026-06-01T00:00:00Z",
    },
  };
}

describe("status page service", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a sanitized component mapping without persisting secrets", async () => {
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "status_pages") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "page-1",
                organization_id: "org-1",
                name: "Ops",
                slug: "ops",
                description: null,
                is_public: false,
                created_at: "2026-06-01T00:00:00Z",
                updated_at: "2026-06-01T00:00:00Z",
              },
              error: null,
            }),
          };
        }

        if (table === "status_page_components") {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "component-1",
                organization_id: "org-1",
                status_page_id: "page-1",
                monitored_app_id: "app-1",
                environment_id: "env-1",
                monitor_id: "monitor-1",
                display_name: "API component",
                sort_order: 2,
                is_visible: true,
                created_at: "2026-06-01T00:00:00Z",
                updated_at: "2026-06-01T00:00:00Z",
              },
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const component = await createStatusPageComponent(
      createContext(),
      "page-1",
      {
        monitoredAppId: "app-1",
        environmentId: "env-1",
        monitorId: "monitor-1",
        displayName: "API component",
        sortOrder: 2,
        isVisible: true,
      },
      adminClient as never,
    );

    expect(component).toMatchObject({
      id: "component-1",
      displayName: "API component",
      monitoredAppId: "app-1",
      monitorId: "monitor-1",
    });
    expect(JSON.stringify(component)).not.toContain("configuration");
  });

  it("rejects cross-app monitor mapping combinations", async () => {
    const { getMonitorById } = await import("@/lib/server/monitors/monitor-service");
    vi.mocked(getMonitorById).mockResolvedValueOnce({
      id: "monitor-2",
      appId: "app-2",
      environmentId: "env-2",
      name: "Other monitor",
      slug: "other-monitor",
      type: "api_health",
      status: "operational",
      isEnabled: true,
      requestMethod: "GET",
      targetSummary: "https://other.example.com/health",
      expectedStatusCodes: [200],
      intervalSeconds: 300,
      nextCheckAt: null,
      timeoutMs: 10000,
      latencyThresholdMs: null,
      consecutiveFailureThreshold: 3,
      consecutiveRecoveryThreshold: 2,
      description: null,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      hasStoredConfiguration: false,
      configurationSummary: null,
    });

    await expect(
      createStatusPageComponent(
        createContext(),
        "page-1",
        {
          monitoredAppId: "app-1",
          environmentId: "env-1",
          monitorId: "monitor-2",
          displayName: "Broken mapping",
          sortOrder: 0,
          isVisible: true,
        },
        {
          from: vi.fn((table: string) => {
            if (table === "status_pages") {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "page-1",
                    organization_id: "org-1",
                    name: "Ops",
                    slug: "ops",
                    description: null,
                    is_public: false,
                    created_at: "2026-06-01T00:00:00Z",
                    updated_at: "2026-06-01T00:00:00Z",
                  },
                  error: null,
                }),
              };
            }

            throw new Error(`Unexpected table: ${table}`);
          }),
        } as never,
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
