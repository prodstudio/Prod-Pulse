import { describe, expect, it, vi } from "vitest";

import {
  queueIncidentAlertDeliveries,
  runAlertDeliveryRunner,
} from "@/lib/server/alerts/alert-engine";
import type { RawIncidentRecord } from "@/lib/server/incidents/incident-sanitization";

vi.mock("@/lib/server/alerts/notification-channel-service", () => ({
  getNotificationChannelConfigForDelivery: vi.fn().mockResolvedValue({
    channel: {
      id: "channel-1",
      organizationId: "org-1",
      name: "Primary",
      type: "slack",
      isEnabled: true,
      maskedDestination: "hooks.slack.com/.../mnop",
      encryptedConfig: null,
      lastTestedAt: null,
      lastTestStatus: null,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    },
    config: {
      webhookUrl: "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop",
    },
  }),
}));

function createIncident(overrides: Partial<RawIncidentRecord> = {}): RawIncidentRecord {
  return {
    id: "incident-1",
    organizationId: "org-1",
    appId: "app-1",
    environmentId: "env-1",
    monitorId: "monitor-1",
    createdFromResultId: "result-1",
    title: "API health is down",
    summary: "The endpoint responded with HTTP 503.",
    severity: "critical",
    status: "detected",
    dedupeKey: "primary_failure",
    assignedTo: null,
    openedBy: null,
    detectedAt: "2026-06-01T00:00:00Z",
    openedAt: null,
    acknowledgedAt: null,
    recoveredAt: null,
    resolvedAt: null,
    autoResolveOnRecovery: false,
    rootCause: null,
    resolutionNotes: null,
    lastStateChangeAt: "2026-06-01T00:00:00Z",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("alert engine", () => {
  it("queues a delivery when an incident event matches a rule", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "alert_rules") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "rule-1",
                      organization_id: "org-1",
                      app_id: null,
                      monitor_id: null,
                      is_enabled: true,
                      severity_filter: ["critical"],
                      send_recovery: true,
                      notify_on_degraded: true,
                      dedupe_window_seconds: 1800,
                      max_retry_attempts: 5,
                      backoff_strategy: "exponential",
                      configuration: {
                        eventTypes: ["incident_created"],
                        notificationChannelIds: ["channel-1"],
                      },
                    },
                  ],
                  error: null,
                }),
              }),
          };
        }
        if (table === "notification_channels") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ id: "channel-1" }],
              error: null,
            }),
          };
        }
        if (table === "alert_deliveries") {
          return {
            insert,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const summary = await queueIncidentAlertDeliveries(
      {
        incident: createIncident(),
        eventType: "incident_created",
      },
      adminClient as never,
    );

    expect(summary).toEqual({
      queuedCount: 1,
      duplicateCount: 0,
      skippedCount: 0,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        incident_id: "incident-1",
        event_type: "incident_created",
        notification_channel_id: "channel-1",
      }),
    );
  });

  it("deduplicates duplicate alert delivery rows safely", async () => {
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "alert_rules") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "rule-1",
                      organization_id: "org-1",
                      app_id: null,
                      monitor_id: null,
                      is_enabled: true,
                      severity_filter: ["critical"],
                      send_recovery: true,
                      notify_on_degraded: true,
                      dedupe_window_seconds: 1800,
                      max_retry_attempts: 5,
                      backoff_strategy: "exponential",
                      configuration: {
                        eventTypes: ["incident_resolved"],
                        notificationChannelIds: ["channel-1"],
                      },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "notification_channels") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ id: "channel-1" }],
              error: null,
            }),
          };
        }
        if (table === "alert_deliveries") {
          return {
            insert: vi.fn().mockResolvedValue({
              error: {
                code: "23505",
                message: "duplicate key",
              },
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const summary = await queueIncidentAlertDeliveries(
      {
        incident: createIncident({ status: "resolved", resolvedAt: "2026-06-01T00:10:00Z" }),
        eventType: "incident_resolved",
      },
      adminClient as never,
    );

    expect(summary).toEqual({
      queuedCount: 0,
      duplicateCount: 1,
      skippedCount: 0,
    });
  });

  it("sends successful deliveries and retries failed ones without crashing the batch", async () => {
    const deliveryUpdates: Array<Record<string, unknown>> = [];
    const attemptRows: Array<Record<string, unknown>> = [];
    const selectRows = [
      {
        id: "delivery-1",
        organization_id: "org-1",
        incident_id: "incident-1",
        monitor_id: "monitor-1",
        alert_rule_id: "rule-1",
        notification_channel_id: "channel-1",
        event_type: "incident_created",
        dedupe_key: "dedupe-1",
        status: "pending",
        severity: "critical",
        scheduled_for: "2026-06-01T00:00:00Z",
        next_retry_at: null,
        final_error: null,
        provider_response: {},
        created_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "delivery-2",
        organization_id: "org-1",
        incident_id: "incident-2",
        monitor_id: "monitor-2",
        alert_rule_id: "rule-2",
        notification_channel_id: "channel-1",
        event_type: "incident_resolved",
        dedupe_key: "dedupe-2",
        status: "pending",
        severity: "warning",
        scheduled_for: "2026-06-01T00:00:00Z",
        next_retry_at: null,
        final_error: null,
        provider_response: {},
        created_at: "2026-06-01T00:00:01Z",
      },
    ];

    let claimIndex = 0;
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "alert_deliveries") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: selectRows,
              error: null,
            }),
            update: vi.fn((patch: Record<string, unknown>) => {
              deliveryUpdates.push(patch);
              return {
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data:
                    patch.status === "sending"
                      ? {
                          ...selectRows[claimIndex++],
                          status: "sending",
                        }
                      : null,
                  error: null,
                }),
              };
            }),
            eq: vi.fn().mockReturnThis(),
          };
        }

        if (table === "incidents") {
          let incidentCall = 0;
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockImplementation(async () => {
              incidentCall += 1;
              return {
                data: {
                  id: `incident-${incidentCall}`,
                  title: incidentCall === 1 ? "API health is down" : "API health recovered",
                  summary: incidentCall === 1 ? "HTTP 503" : "Recovered",
                  severity: incidentCall === 1 ? "critical" : "warning",
                  status: incidentCall === 1 ? "detected" : "resolved",
                  app_id: "app-1",
                  monitor_id: "monitor-1",
                },
                error: null,
              };
            }),
          };
        }

        if (table === "monitored_apps") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { name: "Tiquer" },
              error: null,
            }),
          };
        }

        if (table === "monitors") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { name: "API health" },
              error: null,
            }),
          };
        }

        if (table === "alert_delivery_attempts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
              attemptRows.push(row);
              return { error: null };
            }),
          };
        }

        if (table === "alert_rules") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { max_retry_attempts: 3 },
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const sendSlackNotificationImpl = vi
      .fn()
      .mockResolvedValueOnce({
        providerResponse: {
          ok: true,
          statusCode: 200,
          bodySummary: "ok",
        },
      })
      .mockRejectedValueOnce(new Error("provider down"));

    const summary = await runAlertDeliveryRunner(
      { batchSize: 2 },
      {
        sendSlackNotificationImpl,
      },
      adminClient as never,
    );

    expect(summary).toMatchObject({
      selectedCount: 2,
      sentCount: 1,
      failedCount: 1,
      skippedCount: 0,
    });
    expect(attemptRows).toHaveLength(2);
    expect(attemptRows[0]).toMatchObject({ status: "sent" });
    expect(attemptRows[1]).toMatchObject({ status: "retrying" });
    expect(
      deliveryUpdates.some((patch) => patch.status === "sent"),
    ).toBe(true);
    expect(
      deliveryUpdates.some((patch) => patch.status === "retrying"),
    ).toBe(true);
  });
});
