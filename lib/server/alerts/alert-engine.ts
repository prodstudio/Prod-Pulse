import "server-only";

import { randomUUID } from "node:crypto";

import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import {
  ALERT_EVENT_TYPES,
  sanitizeProviderResponseSummary,
  sanitizeSlackSummary,
  sanitizeSlackText,
  type AlertEventType,
} from "@/lib/server/alerts/alert-sanitization";
import { getNotificationChannelConfigForDelivery } from "@/lib/server/alerts/notification-channel-service";
import { sendSlackNotification } from "@/lib/server/alerts/slack";
import type { RawIncidentRecord } from "@/lib/server/incidents/incident-sanitization";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type RawAlertRuleRecord = {
  id: string;
  organizationId: string;
  appId: string | null;
  monitorId: string | null;
  isEnabled: boolean;
  severityFilter: Array<"info" | "warning" | "critical" | "emergency">;
  sendRecovery: boolean;
  notifyOnDegraded: boolean;
  dedupeWindowSeconds: number;
  maxRetryAttempts: number;
  backoffStrategy: string;
  configuration: {
    eventTypes: AlertEventType[];
    notificationChannelIds: string[];
  };
};

type RawAlertDeliveryRecord = {
  id: string;
  organizationId: string;
  incidentId: string | null;
  monitorId: string | null;
  alertRuleId: string | null;
  notificationChannelId: string;
  eventType: string;
  dedupeKey: string;
  status: "pending" | "sending" | "sent" | "failed" | "retrying" | "suppressed";
  severity: "info" | "warning" | "critical" | "emergency";
  scheduledFor: string;
  nextRetryAt: string | null;
  finalError: string | null;
  providerResponse: Record<string, unknown>;
  createdAt: string;
};

type QueueIncidentAlertDeliveriesInput = {
  incident: RawIncidentRecord;
  eventType: AlertEventType;
  eventTimestamp?: string;
  suppressedByMaintenanceWindowId?: string | null;
};

export type IncidentAlertQueueSummary = {
  queuedCount: number;
  duplicateCount: number;
  skippedCount: number;
};

export type AlertRunnerSummary = {
  runId: string;
  selectedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
};

type RunAlertDeliveryRunnerOptions = {
  batchSize?: number;
};

type AlertRunnerDependencies = {
  sendSlackNotificationImpl?: typeof sendSlackNotification;
};

type IncidentDeliveryContext = {
  incident: {
    id: string;
    title: string;
    summary: string | null;
    severity: "info" | "warning" | "critical" | "emergency";
    status: string;
  };
  appName: string | null;
  monitorName: string | null;
};

const DEFAULT_ALERT_BATCH_SIZE = 20;
const MAX_ALERT_BATCH_SIZE = 50;

function mapAlertRuleRow(row: Record<string, unknown>): RawAlertRuleRecord {
  const configuration = ((row.configuration as Record<string, unknown> | null) ?? {}) as Record<
    string,
    unknown
  >;

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    appId: (row.app_id as string | null) ?? null,
    monitorId: (row.monitor_id as string | null) ?? null,
    isEnabled: Boolean(row.is_enabled),
    severityFilter:
      ((row.severity_filter as RawAlertRuleRecord["severityFilter"] | null) ?? []).filter(Boolean),
    sendRecovery: Boolean(row.send_recovery),
    notifyOnDegraded: Boolean(row.notify_on_degraded),
    dedupeWindowSeconds: Number(row.dedupe_window_seconds),
    maxRetryAttempts: Number(row.max_retry_attempts),
    backoffStrategy: String(row.backoff_strategy),
    configuration: {
      eventTypes: Array.isArray(configuration.eventTypes)
        ? configuration.eventTypes.filter(
            (value): value is AlertEventType =>
              typeof value === "string" &&
              (ALERT_EVENT_TYPES as readonly string[]).includes(value),
          )
        : [],
      notificationChannelIds: Array.isArray(configuration.notificationChannelIds)
        ? configuration.notificationChannelIds.filter(
            (value): value is string => typeof value === "string" && value.length > 0,
          )
        : [],
    },
  };
}

function mapAlertDeliveryRow(row: Record<string, unknown>): RawAlertDeliveryRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    incidentId: (row.incident_id as string | null) ?? null,
    monitorId: (row.monitor_id as string | null) ?? null,
    alertRuleId: (row.alert_rule_id as string | null) ?? null,
    notificationChannelId: String(row.notification_channel_id),
    eventType: String(row.event_type),
    dedupeKey: String(row.dedupe_key),
    status: String(row.status) as RawAlertDeliveryRecord["status"],
    severity: String(row.severity) as RawAlertDeliveryRecord["severity"],
    scheduledFor: String(row.scheduled_for),
    nextRetryAt: (row.next_retry_at as string | null) ?? null,
    finalError: (row.final_error as string | null) ?? null,
    providerResponse: ((row.provider_response as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >,
    createdAt: String(row.created_at),
  };
}

function shouldSendRuleForIncidentEvent(rule: RawAlertRuleRecord, input: QueueIncidentAlertDeliveriesInput) {
  if (!rule.isEnabled) {
    return false;
  }

  if (!rule.configuration.eventTypes.includes(input.eventType)) {
    return false;
  }

  if (rule.appId && rule.appId !== input.incident.appId) {
    return false;
  }

  if (rule.monitorId && rule.monitorId !== input.incident.monitorId) {
    return false;
  }

  if (
    rule.severityFilter.length > 0 &&
    !rule.severityFilter.includes(input.incident.severity)
  ) {
    return false;
  }

  if (input.eventType === "incident_recovered" && !rule.sendRecovery) {
    return false;
  }

  if (input.incident.severity === "warning" && !rule.notifyOnDegraded) {
    return false;
  }

  return rule.configuration.notificationChannelIds.length > 0;
}

function buildDeliveryDedupeKey(
  rule: RawAlertRuleRecord,
  input: QueueIncidentAlertDeliveriesInput,
  channelId: string,
) {
  const eventTimestamp = new Date(
    input.eventTimestamp ??
      input.incident.lastStateChangeAt ??
      input.incident.updatedAt ??
      input.incident.createdAt,
  );
  const bucketWindowSeconds = Math.max(rule.dedupeWindowSeconds, 1);
  const bucket =
    Math.floor(eventTimestamp.getTime() / 1000 / bucketWindowSeconds) *
    bucketWindowSeconds;

  return [
    "incident",
    input.eventType,
    input.incident.id,
    rule.id,
    channelId,
    bucket,
  ].join(":");
}

async function getEnabledChannelIds(
  organizationId: string,
  channelIds: string[],
  adminClient: AdminLike,
) {
  const uniqueIds = Array.from(new Set(channelIds));

  if (uniqueIds.length === 0) {
    return [];
  }

  const { data, error } = await adminClient
    .from("notification_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_enabled", true)
    .eq("type", "slack")
    .in("id", uniqueIds);

  if (error) {
    throw mapPostgresError(error);
  }

  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function listMatchingAlertRules(
  input: QueueIncidentAlertDeliveriesInput,
  adminClient: AdminLike,
) {
  const { data, error } = await adminClient
    .from("alert_rules")
    .select(
      "id, organization_id, app_id, monitor_id, is_enabled, severity_filter, send_recovery, notify_on_degraded, dedupe_window_seconds, max_retry_attempts, backoff_strategy, configuration",
    )
    .eq("organization_id", input.incident.organizationId)
    .eq("is_enabled", true);

  if (error) {
    throw mapPostgresError(error);
  }

  const rules = ((data ?? []) as Record<string, unknown>[]).map((row) =>
    mapAlertRuleRow(row),
  );

  return rules.filter((rule) => shouldSendRuleForIncidentEvent(rule, input));
}

export async function queueIncidentAlertDeliveries(
  input: QueueIncidentAlertDeliveriesInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<IncidentAlertQueueSummary> {
  const rules = await listMatchingAlertRules(input, adminClient);

  if (rules.length === 0) {
    return {
      queuedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
    };
  }

  let queuedCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;

  for (const rule of rules) {
    const enabledChannelIds = await getEnabledChannelIds(
      input.incident.organizationId,
      rule.configuration.notificationChannelIds,
      adminClient,
    );

    if (enabledChannelIds.length === 0) {
      skippedCount += 1;
      continue;
    }

    for (const channelId of enabledChannelIds) {
      const dedupeKey = buildDeliveryDedupeKey(rule, input, channelId);
      const deliveryRow = {
        organization_id: input.incident.organizationId,
        incident_id: input.incident.id,
        monitor_id: input.incident.monitorId,
        alert_rule_id: rule.id,
        notification_channel_id: channelId,
        event_type: input.eventType,
        dedupe_key: dedupeKey,
        status: input.suppressedByMaintenanceWindowId ? "suppressed" : "pending",
        severity: input.incident.severity,
        scheduled_for: new Date().toISOString(),
        suppressed_by_maintenance_window_id: input.suppressedByMaintenanceWindowId ?? null,
      };

      const { error } = await adminClient.from("alert_deliveries").insert(deliveryRow);

      if (error) {
        if (error.code === "23505") {
          duplicateCount += 1;
          continue;
        }

        throw mapPostgresError(error);
      }

      queuedCount += 1;
    }
  }

  return {
    queuedCount,
    duplicateCount,
    skippedCount,
  };
}

async function loadIncidentDeliveryContext(
  delivery: RawAlertDeliveryRecord,
  adminClient: AdminLike,
): Promise<IncidentDeliveryContext> {
  if (!delivery.incidentId) {
    throw new ApiError(400, "request_failed", "The request could not be completed.");
  }

  const { data: incidentRow, error: incidentError } = await adminClient
    .from("incidents")
    .select("id, title, summary, severity, status, app_id, monitor_id")
    .eq("organization_id", delivery.organizationId)
    .eq("id", delivery.incidentId)
    .maybeSingle();

  if (incidentError) {
    throw mapPostgresError(incidentError);
  }

  if (!incidentRow) {
    throw new ApiError(400, "request_failed", "The request could not be completed.");
  }

  const incident = incidentRow as Record<string, unknown>;
  const [appResult, monitorResult] = await Promise.all([
    adminClient
      .from("monitored_apps")
      .select("name")
      .eq("organization_id", delivery.organizationId)
      .eq("id", String(incident.app_id))
      .maybeSingle(),
    adminClient
      .from("monitors")
      .select("name")
      .eq("organization_id", delivery.organizationId)
      .eq("id", String(incident.monitor_id))
      .maybeSingle(),
  ]);

  if (appResult.error) {
    throw mapPostgresError(appResult.error);
  }
  if (monitorResult.error) {
    throw mapPostgresError(monitorResult.error);
  }

  return {
    incident: {
      id: String(incident.id),
      title: String(incident.title),
      summary: sanitizeSlackText((incident.summary as string | null) ?? null),
      severity: String(incident.severity) as IncidentDeliveryContext["incident"]["severity"],
      status: String(incident.status),
    },
    appName: (appResult.data?.name as string | undefined) ?? null,
    monitorName: (monitorResult.data?.name as string | undefined) ?? null,
  };
}

function buildIncidentUrl(incidentId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!baseUrl) {
    return null;
  }

  try {
    return new URL(`/incidents/${incidentId}`, baseUrl).toString();
  } catch {
    return null;
  }
}

function buildSlackAlertMessage(
  delivery: RawAlertDeliveryRecord,
  context: IncidentDeliveryContext,
) {
  const lines = [
    "*Prod Pulse*",
    `Event: ${delivery.eventType}`,
    `Severity: ${context.incident.severity}`,
    `Status: ${context.incident.status}`,
    `Incident: ${context.incident.title}`,
  ];

  if (context.incident.summary) {
    lines.push(`Summary: ${context.incident.summary}`);
  }

  if (context.appName) {
    lines.push(`App: ${context.appName}`);
  }

  if (context.monitorName) {
    lines.push(`Monitor: ${context.monitorName}`);
  }

  const incidentUrl = buildIncidentUrl(context.incident.id);

  if (incidentUrl) {
    lines.push(`Open: ${incidentUrl}`);
  }

  return lines.join("\n");
}

function computeNextRetryAt(attemptNumber: number) {
  const backoffSeconds = Math.min(300, 30 * 2 ** Math.max(attemptNumber - 1, 0));
  return new Date(Date.now() + backoffSeconds * 1000).toISOString();
}

async function getAttemptCount(
  delivery: RawAlertDeliveryRecord,
  adminClient: AdminLike,
) {
  const { data, error } = await adminClient
    .from("alert_delivery_attempts")
    .select("attempt_number")
    .eq("organization_id", delivery.organizationId)
    .eq("alert_delivery_id", delivery.id)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  return data ? Number(data.attempt_number) : 0;
}

async function getRetryPolicy(delivery: RawAlertDeliveryRecord, adminClient: AdminLike) {
  if (!delivery.alertRuleId) {
    return {
      maxRetryAttempts: 5,
    };
  }

  const { data, error } = await adminClient
    .from("alert_rules")
    .select("max_retry_attempts")
    .eq("organization_id", delivery.organizationId)
    .eq("id", delivery.alertRuleId)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  return {
    maxRetryAttempts: data ? Number(data.max_retry_attempts) : 5,
  };
}

async function appendDeliveryAttempt(
  delivery: RawAlertDeliveryRecord,
  input: {
    attemptNumber: number;
    status: RawAlertDeliveryRecord["status"];
    durationMs: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    providerResponse?: Record<string, unknown>;
  },
  adminClient: AdminLike,
) {
  const { error } = await adminClient.from("alert_delivery_attempts").insert({
    organization_id: delivery.organizationId,
    alert_delivery_id: delivery.id,
    attempt_number: input.attemptNumber,
    status: input.status,
    duration_ms: input.durationMs,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    provider_response: sanitizeProviderResponseSummary(input.providerResponse),
  });

  if (error) {
    throw mapPostgresError(error);
  }
}

async function claimDelivery(
  delivery: RawAlertDeliveryRecord,
  adminClient: AdminLike,
) {
  const { data, error } = await adminClient
    .from("alert_deliveries")
    .update({
      status: "sending",
      final_error: null,
    })
    .eq("organization_id", delivery.organizationId)
    .eq("id", delivery.id)
    .in("status", ["pending", "retrying"])
    .select(
      "id, organization_id, incident_id, monitor_id, alert_rule_id, notification_channel_id, event_type, dedupe_key, status, severity, scheduled_for, next_retry_at, final_error, provider_response, created_at",
    )
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  return data ? mapAlertDeliveryRow(data as Record<string, unknown>) : null;
}

export async function runAlertDeliveryRunner(
  options: RunAlertDeliveryRunnerOptions = {},
  dependencies: AlertRunnerDependencies = {},
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<AlertRunnerSummary> {
  const startedAt = Date.now();
  const now = new Date();
  const runId = randomUUID();
  const batchSize = Math.min(
    Math.max(options.batchSize ?? DEFAULT_ALERT_BATCH_SIZE, 1),
    MAX_ALERT_BATCH_SIZE,
  );

  const { data, error } = await adminClient
    .from("alert_deliveries")
    .select(
      "id, organization_id, incident_id, monitor_id, alert_rule_id, notification_channel_id, event_type, dedupe_key, status, severity, scheduled_for, next_retry_at, final_error, provider_response, created_at",
    )
    .in("status", ["pending", "retrying"])
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    throw mapPostgresError(error);
  }

  const candidates = ((data ?? []) as Record<string, unknown>[])
    .map((row) => mapAlertDeliveryRow(row))
    .filter((delivery) => {
      if (delivery.status === "pending") {
        return new Date(delivery.scheduledFor).getTime() <= now.getTime();
      }

      return delivery.nextRetryAt
        ? new Date(delivery.nextRetryAt).getTime() <= now.getTime()
        : true;
    });

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const sendSlackNotificationImpl =
    dependencies.sendSlackNotificationImpl ?? sendSlackNotification;

  for (const candidate of candidates) {
    const claimed = await claimDelivery(candidate, adminClient);

    if (!claimed) {
      skippedCount += 1;
      continue;
    }

    const startedAttemptAt = Date.now();
    const nextAttemptNumber = (await getAttemptCount(claimed, adminClient)) + 1;

    try {
      const [{ channel, config }, incidentContext] = await Promise.all([
        getNotificationChannelConfigForDelivery(
          claimed.organizationId,
          claimed.notificationChannelId,
          adminClient,
        ),
        loadIncidentDeliveryContext(claimed, adminClient),
      ]);

      if (!channel.isEnabled || channel.type !== "slack" || !config?.webhookUrl) {
        await appendDeliveryAttempt(
          claimed,
          {
            attemptNumber: nextAttemptNumber,
            status: "suppressed",
            durationMs: Date.now() - startedAttemptAt,
            errorCode: "channel_unavailable",
            errorMessage: "The delivery channel is unavailable.",
          },
          adminClient,
        );

        const { error: suppressError } = await adminClient
          .from("alert_deliveries")
          .update({
            status: "suppressed",
            final_error: "The delivery channel is unavailable.",
            next_retry_at: null,
            provider_response: {},
          })
          .eq("organization_id", claimed.organizationId)
          .eq("id", claimed.id);

        if (suppressError) {
          throw mapPostgresError(suppressError);
        }

        skippedCount += 1;
        continue;
      }

      const providerResult = await sendSlackNotificationImpl({
        webhookUrl: config.webhookUrl,
        text: buildSlackAlertMessage(claimed, incidentContext),
      });

      await appendDeliveryAttempt(
        claimed,
        {
          attemptNumber: nextAttemptNumber,
          status: "sent",
          durationMs: Date.now() - startedAttemptAt,
          providerResponse: providerResult.providerResponse,
        },
        adminClient,
      );

      const { error: updateError } = await adminClient
        .from("alert_deliveries")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          next_retry_at: null,
          final_error: null,
          provider_response: providerResult.providerResponse,
        })
        .eq("organization_id", claimed.organizationId)
        .eq("id", claimed.id);

      if (updateError) {
        throw mapPostgresError(updateError);
      }

      sentCount += 1;
    } catch (error) {
      const retryPolicy = await getRetryPolicy(claimed, adminClient);
      const safeError = sanitizeSlackSummary(
        error instanceof ApiError ? error.message : "The request could not be completed.",
      ) ?? "The request could not be completed.";
      const canRetry = nextAttemptNumber < retryPolicy.maxRetryAttempts;
      const nextStatus = canRetry ? "retrying" : "failed";

      await appendDeliveryAttempt(
        claimed,
        {
          attemptNumber: nextAttemptNumber,
          status: nextStatus,
          durationMs: Date.now() - startedAttemptAt,
          errorCode: "delivery_failed",
          errorMessage: safeError,
        },
        adminClient,
      );

      const { error: updateError } = await adminClient
        .from("alert_deliveries")
        .update({
          status: nextStatus,
          next_retry_at: canRetry ? computeNextRetryAt(nextAttemptNumber) : null,
          final_error: safeError,
          provider_response: {},
        })
        .eq("organization_id", claimed.organizationId)
        .eq("id", claimed.id);

      if (updateError) {
        throw mapPostgresError(updateError);
      }

      failedCount += 1;
    }
  }

  return {
    runId,
    selectedCount: candidates.length,
    sentCount,
    failedCount,
    skippedCount,
    durationMs: Date.now() - startedAt,
  };
}
