import { describe, expect, it } from "vitest";

import {
  buildStatusPagePreviewComponent,
  deriveOverallStatus,
} from "@/lib/server/status-pages/status-aggregation";
import type { RawStatusPageComponentRecord } from "@/lib/server/status-pages/status-page-sanitization";

function createComponent(
  overrides: Partial<RawStatusPageComponentRecord> = {},
): RawStatusPageComponentRecord {
  return {
    id: "component-1",
    organizationId: "org-1",
    statusPageId: "page-1",
    monitoredAppId: "app-1",
    environmentId: "env-1",
    monitorId: "monitor-1",
    displayName: "API",
    sortOrder: 0,
    isVisible: true,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function createLookup(overrides: Partial<Parameters<typeof buildStatusPagePreviewComponent>[1]> = {}) {
  return {
    appsById: new Map([
      [
        "app-1",
        {
          id: "app-1",
          name: "Tiquer",
          slug: "tiquer",
          description: null,
          ownerTeam: null,
          status: "operational",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    ]),
    environmentsById: new Map([
      [
        "env-1",
        {
          id: "env-1",
          appId: "app-1",
          name: "Production",
          slug: "production",
          type: "production",
          baseUrl: null,
          status: "operational",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    ]),
    monitorsById: new Map([
      [
        "monitor-1",
        {
          id: "monitor-1",
          appId: "app-1",
          environmentId: "env-1",
          name: "API health",
          slug: "api-health",
          type: "api_health" as const,
          status: "operational",
          isEnabled: true,
          requestMethod: "GET",
          targetSummary: "https://api.example.com/health",
          expectedStatusCodes: [200],
          intervalSeconds: 300,
          nextCheckAt: "2026-06-01T00:05:00Z",
          timeoutMs: 10000,
          latencyThresholdMs: null,
          consecutiveFailureThreshold: 3,
          consecutiveRecoveryThreshold: 2,
          description: null,
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
          hasStoredConfiguration: false,
          configurationSummary: null,
        },
      ],
    ]),
    latestResultsByMonitorId: new Map([
      [
        "monitor-1",
        {
          id: "result-1",
          status: "success",
          triggerSource: "scheduled",
          checkedAt: "2026-06-01T00:01:00Z",
          durationMs: 120,
          httpStatus: 200,
          errorCode: null,
          errorSummary: null,
          responseSummary: null,
          assertionSummary: null,
          metadataSummary: null,
        },
      ],
    ]),
    activeIncidents: [],
    activeMaintenanceWindows: [],
    heartbeatsByMonitorId: new Map(),
    ...overrides,
  };
}

describe("status aggregation", () => {
  it("maps degraded monitor state to degraded component status", () => {
    const component = buildStatusPagePreviewComponent(
      createComponent(),
      createLookup({
        monitorsById: new Map([
          [
            "monitor-1",
            {
              ...createLookup().monitorsById.get("monitor-1")!,
              status: "degraded",
            },
          ],
        ]),
      }),
    );

    expect(component.status).toBe("degraded");
  });

  it("maps unresolved high severity incidents to major outage", () => {
    const component = buildStatusPagePreviewComponent(
      createComponent(),
      createLookup({
        activeIncidents: [
          {
            id: "incident-1",
            appId: "app-1",
            environmentId: "env-1",
            monitorId: "monitor-1",
            title: "API down",
            summary: null,
            severity: "critical",
            status: "open",
            appName: "Tiquer",
            appSlug: "tiquer",
            monitorName: "API health",
            monitorSlug: "api-health",
            environmentName: "Production",
            detectedAt: "2026-06-01T00:00:00Z",
            openedAt: "2026-06-01T00:00:00Z",
            acknowledgedAt: null,
            recoveredAt: null,
            resolvedAt: null,
            lastStateChangeAt: "2026-06-01T00:00:00Z",
            createdAt: "2026-06-01T00:00:00Z",
            updatedAt: "2026-06-01T00:00:00Z",
            durationSeconds: 60,
          },
        ],
      }),
    );

    expect(component.status).toBe("major_outage");
    expect(component.evidence.incidentId).toBe("incident-1");
  });

  it("shows maintenance when there is no stronger outage evidence", () => {
    const component = buildStatusPagePreviewComponent(
      createComponent({ monitorId: null, environmentId: null }),
      createLookup({
        monitorsById: new Map(),
        latestResultsByMonitorId: new Map(),
        activeMaintenanceWindows: [
          {
            id: "mw-1",
            scope: "app",
            title: "Planned maintenance",
            appId: "app-1",
            environmentId: null,
            monitorId: null,
          },
        ],
      }),
    );

    expect(component.status).toBe("maintenance");
    expect(component.evidence.maintenanceWindowId).toBe("mw-1");
  });

  it("does not let maintenance hide stronger outage evidence", () => {
    const component = buildStatusPagePreviewComponent(
      createComponent(),
      createLookup({
        activeMaintenanceWindows: [
          {
            id: "mw-1",
            scope: "monitor",
            title: "Maintenance",
            appId: null,
            environmentId: null,
            monitorId: "monitor-1",
          },
        ],
        latestResultsByMonitorId: new Map([
          [
            "monitor-1",
            {
              id: "result-1",
              status: "failure",
              triggerSource: "scheduled",
              checkedAt: "2026-06-01T00:01:00Z",
              durationMs: 120,
              httpStatus: 500,
              errorCode: "HTTP_500",
              errorSummary: "The endpoint responded with HTTP 500.",
              responseSummary: null,
              assertionSummary: null,
              metadataSummary: null,
            },
          ],
        ]),
      }),
    );

    expect(component.status).toBe("major_outage");
    expect(component.maintenanceTitle).toBe("Maintenance");
  });

  it("returns unknown when there is no evidence", () => {
    const component = buildStatusPagePreviewComponent(
      createComponent({ monitoredAppId: null, environmentId: null, monitorId: null }),
      createLookup({
        appsById: new Map(),
        environmentsById: new Map(),
        monitorsById: new Map(),
        latestResultsByMonitorId: new Map(),
      }),
    );

    expect(component.status).toBe("unknown");
  });

  it("derives overall status from the worst component", () => {
    expect(
      deriveOverallStatus([
        { status: "operational" },
        { status: "degraded" },
        { status: "major_outage" },
      ]),
    ).toBe("major_outage");
  });

  it("keeps preview evidence sanitized without raw monitor configuration", () => {
    const component = buildStatusPagePreviewComponent(
      createComponent(),
      createLookup(),
    );

    expect(JSON.stringify(component)).not.toContain("configuration");
    expect(component.targetSummary).toBe("https://api.example.com/health");
  });

  it("uses the worst related monitor result for app-level components", () => {
    const component = buildStatusPagePreviewComponent(
      createComponent({ monitorId: null, environmentId: null }),
      createLookup({
        monitorsById: new Map([
          ...createLookup().monitorsById,
          [
            "monitor-2",
            {
              ...createLookup().monitorsById.get("monitor-1")!,
              id: "monitor-2",
              name: "Worker health",
              slug: "worker-health",
              status: "operational",
            },
          ],
        ]),
        latestResultsByMonitorId: new Map([
          ...createLookup().latestResultsByMonitorId,
          [
            "monitor-2",
            {
              id: "result-2",
              status: "failure",
              triggerSource: "scheduled",
              checkedAt: "2026-06-01T00:02:00Z",
              durationMs: 400,
              httpStatus: 500,
              errorCode: "HTTP_500",
              errorSummary: "The worker failed.",
              responseSummary: null,
              assertionSummary: null,
              metadataSummary: null,
            },
          ],
        ]),
      }),
    );

    expect(component.status).toBe("major_outage");
    expect(component.evidence.latestResultId).toBe("result-2");
  });
});
