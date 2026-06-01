import "server-only";

import {
  sanitizeIncidentText,
  sanitizeIncidentTitle,
} from "@/lib/server/incidents/incident-sanitization";

export type StatusPageState =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

export type RawStatusPageRecord = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RawStatusPageComponentRecord = {
  id: string;
  organizationId: string;
  statusPageId: string;
  monitoredAppId: string | null;
  environmentId: string | null;
  monitorId: string | null;
  displayName: string;
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SafeStatusPageSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  componentCount: number;
};

export type SafeStatusPageComponentSummary = {
  id: string;
  statusPageId: string;
  monitoredAppId: string | null;
  environmentId: string | null;
  monitorId: string | null;
  displayName: string;
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SafeStatusIncidentEvidence = {
  id: string;
  title: string;
  severity: string;
  status: string;
};

export type SafeStatusComponentEvidence = {
  appId: string | null;
  environmentId: string | null;
  monitorId: string | null;
  incidentId: string | null;
  latestResultId: string | null;
  checkedAt: string | null;
  lastSeenAt: string | null;
  maintenanceWindowId: string | null;
};

export type SafeStatusPagePreviewComponent = SafeStatusPageComponentSummary & {
  status: StatusPageState;
  appName: string | null;
  appSlug: string | null;
  environmentName: string | null;
  environmentSlug: string | null;
  monitorName: string | null;
  monitorSlug: string | null;
  monitorType: string | null;
  targetSummary: string | null;
  latestCheckAt: string | null;
  lastSeenAt: string | null;
  maintenanceTitle: string | null;
  statusReason: string | null;
  evidence: SafeStatusComponentEvidence;
  incidents: SafeStatusIncidentEvidence[];
};

export type SafeStatusPagePreview = {
  page: SafeStatusPageSummary;
  overallStatus: StatusPageState;
  latestCheckedAt: string | null;
  incidents: SafeStatusIncidentEvidence[];
  components: SafeStatusPagePreviewComponent[];
};

function sanitizeLabel(value: string | null | undefined, maxLength = 160) {
  if (typeof value !== "string") {
    return null;
  }

  const safe = sanitizeIncidentText(value, maxLength);
  return safe;
}

export function toSafeStatusPageSummary(
  raw: RawStatusPageRecord,
  componentCount = 0,
): SafeStatusPageSummary {
  return {
    id: raw.id,
    name: sanitizeIncidentTitle(raw.name),
    slug: raw.slug,
    description: sanitizeIncidentText(raw.description, 600),
    isPublic: raw.isPublic,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    componentCount,
  };
}

export function toSafeStatusPageComponentSummary(
  raw: RawStatusPageComponentRecord,
): SafeStatusPageComponentSummary {
  return {
    id: raw.id,
    statusPageId: raw.statusPageId,
    monitoredAppId: raw.monitoredAppId,
    environmentId: raw.environmentId,
    monitorId: raw.monitorId,
    displayName: sanitizeIncidentTitle(raw.displayName),
    sortOrder: raw.sortOrder,
    isVisible: raw.isVisible,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function sanitizeStatusPageForAudit(raw: RawStatusPageRecord) {
  return {
    id: raw.id,
    name: sanitizeIncidentTitle(raw.name),
    slug: raw.slug,
    description: sanitizeIncidentText(raw.description, 600),
    isPublic: raw.isPublic,
    updatedAt: raw.updatedAt,
  };
}

export function sanitizeStatusPageComponentForAudit(raw: RawStatusPageComponentRecord) {
  return {
    id: raw.id,
    statusPageId: raw.statusPageId,
    monitoredAppId: raw.monitoredAppId,
    environmentId: raw.environmentId,
    monitorId: raw.monitorId,
    displayName: sanitizeIncidentTitle(raw.displayName),
    sortOrder: raw.sortOrder,
    isVisible: raw.isVisible,
    updatedAt: raw.updatedAt,
  };
}

export function toSafeStatusIncidentEvidence(input: {
  id: string;
  title: string;
  severity: string;
  status: string;
}): SafeStatusIncidentEvidence {
  return {
    id: input.id,
    title: sanitizeIncidentTitle(input.title),
    severity: input.severity,
    status: input.status,
  };
}

export function sanitizeStatusReason(value: string | null | undefined) {
  return sanitizeLabel(value, 220);
}
