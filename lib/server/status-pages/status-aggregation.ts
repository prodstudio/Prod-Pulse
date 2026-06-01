import "server-only";

import type { EnvironmentSummary } from "@/lib/server/apps/environment-service";
import type { AppSummary } from "@/lib/server/apps/app-service";
import type { SafeIncidentSummary } from "@/lib/server/incidents/incident-sanitization";
import type { SafeMonitorSummary } from "@/lib/server/monitors/monitor-sanitization";
import type { SafeMonitorResult } from "@/lib/server/monitoring/result-sanitization";
import type { SafeHeartbeatDetail } from "@/lib/server/heartbeats/heartbeat-sanitization";
import {
  toSafeStatusPageComponentSummary,
  toSafeStatusIncidentEvidence,
  sanitizeStatusReason,
  type RawStatusPageComponentRecord,
  type SafeStatusIncidentEvidence,
  type SafeStatusPagePreviewComponent,
  type StatusPageState,
} from "@/lib/server/status-pages/status-page-sanitization";

type ActiveMaintenanceWindow = {
  id: string;
  scope: string;
  title: string;
  appId: string | null;
  environmentId: string | null;
  monitorId: string | null;
};

type StatusAggregationLookup = {
  appsById: Map<string, AppSummary>;
  environmentsById: Map<string, EnvironmentSummary>;
  monitorsById: Map<string, SafeMonitorSummary>;
  latestResultsByMonitorId: Map<string, SafeMonitorResult>;
  activeIncidents: SafeIncidentSummary[];
  activeMaintenanceWindows: ActiveMaintenanceWindow[];
  heartbeatsByMonitorId: Map<string, SafeHeartbeatDetail>;
};

const INCIDENT_SEVERITY_TO_STATUS: Record<string, StatusPageState> = {
  emergency: "major_outage",
  critical: "major_outage",
  warning: "partial_outage",
  info: "degraded",
};

const STATUS_PRIORITY: Record<StatusPageState, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
  unknown: -1,
};

function deriveMonitorState(monitor: SafeMonitorSummary | undefined): StatusPageState {
  if (!monitor || !monitor.isEnabled) {
    return "unknown";
  }

  switch (monitor.status) {
    case "down":
      return "major_outage";
    case "degraded":
      return "degraded";
    case "maintenance":
      return "maintenance";
    case "operational":
      return "operational";
    default:
      return "unknown";
  }
}

function deriveResultState(result: SafeMonitorResult | undefined): StatusPageState {
  if (!result) {
    return "unknown";
  }

  switch (result.status) {
    case "failure":
    case "timeout":
    case "error":
      return "major_outage";
    case "degraded":
      return "degraded";
    case "success":
      return "operational";
    case "skipped":
    default:
      return "unknown";
  }
}

function deriveResourceState(status: string | undefined): StatusPageState {
  switch (status) {
    case "down":
      return "major_outage";
    case "degraded":
      return "degraded";
    case "maintenance":
      return "maintenance";
    case "operational":
      return "operational";
    default:
      return "unknown";
  }
}

function sortIncidentsBySeverity(incidents: SafeIncidentSummary[]) {
  return [...incidents].sort((left, right) => {
    const leftRank = STATUS_PRIORITY[INCIDENT_SEVERITY_TO_STATUS[left.severity] ?? "degraded"];
    const rightRank = STATUS_PRIORITY[INCIDENT_SEVERITY_TO_STATUS[right.severity] ?? "degraded"];

    if (leftRank !== rightRank) {
      return rightRank - leftRank;
    }

    return new Date(right.detectedAt).getTime() - new Date(left.detectedAt).getTime();
  });
}

function worstState(states: StatusPageState[]) {
  if (states.length === 0) {
    return "unknown" as StatusPageState;
  }

  return states.reduce<StatusPageState>((currentWorst, next) => {
    return STATUS_PRIORITY[next] > STATUS_PRIORITY[currentWorst] ? next : currentWorst;
  }, "unknown");
}

function isMaintenanceMatch(
  component: RawStatusPageComponentRecord,
  maintenance: ActiveMaintenanceWindow,
  relatedMonitorIds: string[],
) {
  if (maintenance.scope === "organization") {
    return true;
  }

  if (maintenance.scope === "monitor") {
    return Boolean(
      (component.monitorId && maintenance.monitorId === component.monitorId) ||
        relatedMonitorIds.includes(maintenance.monitorId ?? ""),
    );
  }

  if (maintenance.scope === "environment") {
    return Boolean(
      component.environmentId && maintenance.environmentId === component.environmentId,
    );
  }

  if (maintenance.scope === "app") {
    return Boolean(component.monitoredAppId && maintenance.appId === component.monitoredAppId);
  }

  return false;
}

function collectRelatedMonitorIds(
  component: RawStatusPageComponentRecord,
  monitorsById: Map<string, SafeMonitorSummary>,
) {
  if (component.monitorId) {
    return monitorsById.has(component.monitorId) ? [component.monitorId] : [];
  }

  return Array.from(monitorsById.values())
    .filter((monitor) => {
      if (component.environmentId) {
        return monitor.environmentId === component.environmentId;
      }

      if (component.monitoredAppId) {
        return monitor.appId === component.monitoredAppId;
      }

      return false;
    })
    .map((monitor) => monitor.id);
}

function collectRelatedMonitors(
  component: RawStatusPageComponentRecord,
  monitorsById: Map<string, SafeMonitorSummary>,
) {
  return collectRelatedMonitorIds(component, monitorsById)
    .map((monitorId) => monitorsById.get(monitorId))
    .filter((monitor): monitor is SafeMonitorSummary => Boolean(monitor));
}

function collectComponentIncidents(
  component: RawStatusPageComponentRecord,
  relatedMonitorIds: string[],
  incidents: SafeIncidentSummary[],
) {
  return incidents.filter((incident) => {
    if (component.monitorId && incident.monitorId === component.monitorId) {
      return true;
    }

    if (relatedMonitorIds.includes(incident.monitorId)) {
      return true;
    }

    if (component.environmentId && incident.environmentId === component.environmentId) {
      return true;
    }

    return Boolean(component.monitoredAppId && incident.appId === component.monitoredAppId);
  });
}

export function deriveOverallStatus(components: Array<{ status: StatusPageState }>): StatusPageState {
  if (components.length === 0) {
    return "unknown";
  }

  return worstState(components.map((component) => component.status));
}

export function buildStatusPagePreviewComponent(
  component: RawStatusPageComponentRecord,
  lookup: StatusAggregationLookup,
): SafeStatusPagePreviewComponent {
  const safeComponent = toSafeStatusPageComponentSummary(component);
  const relatedMonitorIds = collectRelatedMonitorIds(component, lookup.monitorsById);
  const relatedMonitors = collectRelatedMonitors(component, lookup.monitorsById);
  const incidents = sortIncidentsBySeverity(
    collectComponentIncidents(component, relatedMonitorIds, lookup.activeIncidents),
  );
  const maintenanceWindow =
    lookup.activeMaintenanceWindows.find((window) =>
      isMaintenanceMatch(component, window, relatedMonitorIds),
    ) ?? null;

  const primaryMonitor = component.monitorId
    ? lookup.monitorsById.get(component.monitorId)
    : [...relatedMonitors].sort((left, right) => {
        const rightState = worstState([
          deriveMonitorState(right),
          deriveResultState(lookup.latestResultsByMonitorId.get(right.id)),
        ]);
        const leftState = worstState([
          deriveMonitorState(left),
          deriveResultState(lookup.latestResultsByMonitorId.get(left.id)),
        ]);

        return STATUS_PRIORITY[rightState] - STATUS_PRIORITY[leftState];
      })[0];

  const latestResult =
    primaryMonitor ? lookup.latestResultsByMonitorId.get(primaryMonitor.id) : undefined;
  const linkedHeartbeat =
    primaryMonitor?.type === "heartbeat"
      ? lookup.heartbeatsByMonitorId.get(primaryMonitor.id)
      : undefined;

  const app = component.monitoredAppId
    ? lookup.appsById.get(component.monitoredAppId)
    : primaryMonitor
      ? lookup.appsById.get(primaryMonitor.appId)
      : undefined;
  const environment = component.environmentId
    ? lookup.environmentsById.get(component.environmentId)
    : primaryMonitor?.environmentId
      ? lookup.environmentsById.get(primaryMonitor.environmentId)
      : undefined;

  const incidentState =
    incidents.length > 0
      ? INCIDENT_SEVERITY_TO_STATUS[incidents[0].severity] ?? "degraded"
      : "unknown";
  const monitorState =
    relatedMonitors.length > 0
      ? worstState(relatedMonitors.map((monitor) => deriveMonitorState(monitor)))
      : deriveMonitorState(primaryMonitor);
  const resultState =
    relatedMonitors.length > 0
      ? worstState(
          relatedMonitors.map((monitor) =>
            deriveResultState(lookup.latestResultsByMonitorId.get(monitor.id)),
          ),
        )
      : deriveResultState(latestResult);
  const resourceState =
    deriveResourceState(environment?.status) !== "unknown"
      ? deriveResourceState(environment?.status)
      : deriveResourceState(app?.status);

  let status = worstState([incidentState, monitorState, resultState, resourceState]);

  if ((status === "unknown" || status === "operational") && maintenanceWindow) {
    status = "maintenance";
  }

  const evidenceIncident = incidents[0] ?? null;
  const incidentEvidence = incidents.map((incident) =>
    toSafeStatusIncidentEvidence({
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
    }),
  );

  let statusReason: string | null = null;
  if (evidenceIncident) {
    statusReason = `Incident ${evidenceIncident.title} is currently affecting this component.`;
  } else if (status === "major_outage" && primaryMonitor) {
    statusReason = `${primaryMonitor.name} is currently down.`;
  } else if (status === "degraded" && primaryMonitor) {
    statusReason = `${primaryMonitor.name} is reporting degraded behavior.`;
  } else if (maintenanceWindow) {
    statusReason = `${maintenanceWindow.title} is active.`;
  } else if (primaryMonitor) {
    statusReason = `Derived from ${primaryMonitor.name}.`;
  }

  return {
    ...safeComponent,
    status,
    appName: app?.name ?? null,
    appSlug: app?.slug ?? null,
    environmentName: environment?.name ?? null,
    environmentSlug: environment?.slug ?? null,
    monitorName: primaryMonitor?.name ?? null,
    monitorSlug: primaryMonitor?.slug ?? null,
    monitorType: primaryMonitor?.type ?? null,
    targetSummary: primaryMonitor?.targetSummary ?? null,
    latestCheckAt: latestResult?.checkedAt ?? null,
    lastSeenAt: linkedHeartbeat?.lastSeenAt ?? null,
    maintenanceTitle: maintenanceWindow?.title ?? null,
    statusReason: sanitizeStatusReason(statusReason),
    evidence: {
      appId: app?.id ?? component.monitoredAppId,
      environmentId: environment?.id ?? component.environmentId,
      monitorId: primaryMonitor?.id ?? component.monitorId,
      incidentId: evidenceIncident?.id ?? null,
      latestResultId: latestResult?.id ?? null,
      checkedAt: latestResult?.checkedAt ?? null,
      lastSeenAt: linkedHeartbeat?.lastSeenAt ?? null,
      maintenanceWindowId: maintenanceWindow?.id ?? null,
    },
    incidents: incidentEvidence,
  };
}

export function derivePreviewTimestamps(
  components: SafeStatusPagePreviewComponent[],
) {
  const timestamps = components
    .flatMap((component) => [component.latestCheckAt, component.lastSeenAt])
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

export function uniqueIncidentEvidence(
  components: SafeStatusPagePreviewComponent[],
): SafeStatusIncidentEvidence[] {
  const incidentMap = new Map<string, SafeStatusIncidentEvidence>();

  for (const component of components) {
    for (const incident of component.incidents) {
      incidentMap.set(incident.id, incident);
    }
  }

  return Array.from(incidentMap.values());
}
