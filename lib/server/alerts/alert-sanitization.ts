import "server-only";

import { sanitizeIncidentText, sanitizeIncidentTitle } from "@/lib/server/incidents/incident-sanitization";

export const ALERT_EVENT_TYPES = [
  "incident_created",
  "incident_updated",
  "incident_acknowledged",
  "incident_recovered",
  "incident_resolved",
] as const;

export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number];

export type SafeNotificationChannel = {
  id: string;
  organizationId: string;
  name: string;
  type: "slack" | "email" | "whatsapp";
  isEnabled: boolean;
  maskedDestination: string | null;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SafeAlertRule = {
  id: string;
  organizationId: string;
  appId: string | null;
  monitorId: string | null;
  name: string;
  isEnabled: boolean;
  severityFilter: Array<"info" | "warning" | "critical" | "emergency">;
  sendRecovery: boolean;
  notifyOnDegraded: boolean;
  dedupeWindowSeconds: number;
  maxRetryAttempts: number;
  backoffStrategy: string;
  eventTypes: AlertEventType[];
  notificationChannelIds: string[];
  createdAt: string;
  updatedAt: string;
};

type RawNotificationChannelRecord = {
  id: string;
  organizationId: string;
  name: string;
  type: SafeNotificationChannel["type"];
  isEnabled: boolean;
  maskedDestination: string | null;
  encryptedConfig: string | null;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

type RawAlertRuleRecord = {
  id: string;
  organizationId: string;
  appId: string | null;
  monitorId: string | null;
  name: string;
  isEnabled: boolean;
  severityFilter: SafeAlertRule["severityFilter"];
  sendRecovery: boolean;
  notifyOnDegraded: boolean;
  dedupeWindowSeconds: number;
  maxRetryAttempts: number;
  backoffStrategy: string;
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type RawAlertDeliveryRecord = {
  id: string;
  eventType: string;
  status: string;
  severity: string;
  finalError: string | null;
  providerResponse: Record<string, unknown>;
};

export function sanitizeSlackText(value: string | null | undefined) {
  return sanitizeIncidentText(value, 500);
}

export function sanitizeSlackSummary(value: string | null | undefined) {
  return sanitizeIncidentText(value, 240);
}

export function maskSlackWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const tail = pathSegments.slice(-2).join("/");
    const maskedTail = tail ? `.../${tail.slice(-8)}` : "...";

    return `${url.hostname}${maskedTail}`;
  } catch {
    const tail = value.slice(-8);
    return tail ? `slack-webhook-...${tail}` : "slack-webhook";
  }
}

export function sanitizeProviderResponseSummary(response: Record<string, unknown> | null | undefined) {
  if (!response || typeof response !== "object") {
    return {};
  }

  const safeSummary: Record<string, unknown> = {};

  if (typeof response.ok === "boolean") {
    safeSummary.ok = response.ok;
  }

  if (typeof response.statusCode === "number") {
    safeSummary.statusCode = response.statusCode;
  }

  const bodySummary = sanitizeSlackSummary(
    typeof response.bodySummary === "string" ? response.bodySummary : null,
  );

  if (bodySummary) {
    safeSummary.bodySummary = bodySummary;
  }

  return safeSummary;
}

export function sanitizeNotificationChannelForAudit(channel: RawNotificationChannelRecord | SafeNotificationChannel) {
  return {
    id: channel.id,
    organizationId: channel.organizationId,
    name: channel.name,
    type: channel.type,
    isEnabled: channel.isEnabled,
    maskedDestination: channel.maskedDestination,
    lastTestedAt: channel.lastTestedAt,
    lastTestStatus: channel.lastTestStatus,
    updatedAt: channel.updatedAt,
  };
}

function getAlertRuleConfigurationArrays(configuration: Record<string, unknown>) {
  const eventTypes = Array.isArray(configuration.eventTypes)
    ? configuration.eventTypes.filter(
        (value): value is AlertEventType =>
          typeof value === "string" &&
          (ALERT_EVENT_TYPES as readonly string[]).includes(value),
      )
    : [];

  const notificationChannelIds = Array.isArray(configuration.notificationChannelIds)
    ? configuration.notificationChannelIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];

  return {
    eventTypes,
    notificationChannelIds,
  };
}

export function sanitizeAlertRuleForAudit(rule: RawAlertRuleRecord | SafeAlertRule) {
  return {
    id: rule.id,
    organizationId: rule.organizationId,
    appId: rule.appId,
    monitorId: rule.monitorId,
    name: rule.name,
    isEnabled: rule.isEnabled,
    severityFilter: rule.severityFilter,
    sendRecovery: rule.sendRecovery,
    notifyOnDegraded: rule.notifyOnDegraded,
    dedupeWindowSeconds: rule.dedupeWindowSeconds,
    maxRetryAttempts: rule.maxRetryAttempts,
    backoffStrategy: rule.backoffStrategy,
    eventTypes: "configuration" in rule ? getAlertRuleConfigurationArrays(rule.configuration).eventTypes : rule.eventTypes,
    notificationChannelIds:
      "configuration" in rule
        ? getAlertRuleConfigurationArrays(rule.configuration).notificationChannelIds
        : rule.notificationChannelIds,
    updatedAt: rule.updatedAt,
  };
}

export function sanitizeAlertDeliveryForAudit(delivery: RawAlertDeliveryRecord) {
  return {
    id: delivery.id,
    eventType: delivery.eventType,
    status: delivery.status,
    severity: delivery.severity,
    finalError: sanitizeSlackSummary(delivery.finalError),
    providerResponse: sanitizeProviderResponseSummary(delivery.providerResponse),
  };
}

export function toSafeNotificationChannel(channel: RawNotificationChannelRecord): SafeNotificationChannel {
  return {
    id: channel.id,
    organizationId: channel.organizationId,
    name: channel.name,
    type: channel.type,
    isEnabled: channel.isEnabled,
    maskedDestination: channel.maskedDestination,
    lastTestedAt: channel.lastTestedAt,
    lastTestStatus: channel.lastTestStatus,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

export function toSafeAlertRule(rule: RawAlertRuleRecord): SafeAlertRule {
  const { eventTypes, notificationChannelIds } = getAlertRuleConfigurationArrays(
    rule.configuration,
  );

  return {
    id: rule.id,
    organizationId: rule.organizationId,
    appId: rule.appId,
    monitorId: rule.monitorId,
    name: sanitizeIncidentTitle(rule.name),
    isEnabled: rule.isEnabled,
    severityFilter: rule.severityFilter,
    sendRecovery: rule.sendRecovery,
    notifyOnDegraded: rule.notifyOnDegraded,
    dedupeWindowSeconds: rule.dedupeWindowSeconds,
    maxRetryAttempts: rule.maxRetryAttempts,
    backoffStrategy: rule.backoffStrategy,
    eventTypes,
    notificationChannelIds,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}
