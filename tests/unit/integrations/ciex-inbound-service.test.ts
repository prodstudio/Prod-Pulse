import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ciexInboundPayloadSchema,
  ingestCiexInboundIssue,
} from "@/lib/server/integrations/ciex-inbound-service";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

function createRequest(secret = "ciex-secret", body: Record<string, unknown> = {}) {
  return new Request("https://prod-pulse.example.com/api/integrations/ciex/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-prod-pulse-integration-key": secret,
    },
    body: JSON.stringify(body),
  });
}

function createIntegrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "integration-1",
    organization_id: "org-1",
    kind: "ciex",
    name: "CIEX Production",
    is_enabled: true,
    inbound_key_hash: "ignored-by-mock",
    ...overrides,
  };
}

function createIssueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    organization_id: "org-1",
    integration_id: "integration-1",
    source_kind: "ciex",
    external_id: "ticket-123",
    external_key: "CIEX-123",
    title: "Customer cannot sign in",
    status: "open",
    priority: "high",
    source_url: null,
    customer_reference: "Acme Corp",
    summary: "Customer reports repeated auth failures.",
    created_by: null,
    first_seen_at: "2026-06-02T00:00:00Z",
    last_synced_at: "2026-06-02T00:00:00Z",
    source_created_at: null,
    source_updated_at: null,
    related_app_id: "app-1",
    related_environment_id: "env-1",
    related_monitor_id: null,
    created_at: "2026-06-02T00:00:00Z",
    updated_at: "2026-06-02T00:00:00Z",
    ...overrides,
  };
}

function createScopedLookupRow(id: string, appId: string | null, environmentId: string | null = null) {
  return {
    id,
    organization_id: "org-1",
    app_id: appId,
    environment_id: environmentId,
  };
}

describe("ciex inbound service", () => {
  it("creates a normalized external issue from a valid inbound payload", async () => {
    let externalIssueCalls = 0;
    const secret = "ciex-secret";

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "integrations") {
          const select = vi.fn().mockReturnThis();
          const eq = vi.fn().mockReturnThis();
          const maybeSingle = vi
            .fn()
            .mockResolvedValueOnce({ data: createIntegrationRow(), error: null });
          const update = vi.fn().mockReturnThis();
          return {
            select,
            eq,
            maybeSingle,
            update,
          };
        }

        if (table === "monitored_apps") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createScopedLookupRow("app-1", null),
              error: null,
            }),
          };
        }

        if (table === "external_issues") {
          externalIssueCalls += 1;
          if (externalIssueCalls === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }

          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: createIssueRow({
                source_url: null,
                related_app_id: "app-1",
              }),
              error: null,
            }),
          };
        }

        if (table === "incidents") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ingestCiexInboundIssue(
      createRequest(secret, {
        ticket: {
          externalId: "ticket-123",
          externalKey: "CIEX-123",
          title: "Customer cannot sign in",
          summary: "Customer reports repeated auth failures.",
          status: "open",
          priority: "high",
          sourceUrl: "javascript:alert(1)",
          customerReference: "Acme Corp",
          appId: "app-1",
        },
      }),
      {
        ticket: {
          externalId: "ticket-123",
          externalKey: "CIEX-123",
          title: "Customer cannot sign in",
          summary: "Customer reports repeated auth failures.",
          status: "open",
          priority: "high",
          sourceUrl: "javascript:alert(1)",
          customerReference: "Acme Corp",
          appId: "app-1",
        },
      },
      adminClient as never,
    );

    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.issue.sourceKind).toBe("ciex");
    expect(result.issue.sourceUrl).toBeNull();
    expect(result.suggestedIncidentIds).toEqual([]);
    expect(adminClient.from).toHaveBeenCalledWith("integrations");
  });

  it("accepts an inbound key by matching its stored sha256 hash", async () => {
    const secret = "generated-inbound-secret";
    const secretHash = createHash("sha256").update(secret).digest("hex");

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "integrations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createIntegrationRow({ inbound_key_hash: secretHash }),
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          };
        }

        if (table === "external_issues") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: createIssueRow(),
              error: null,
            }),
          };
        }

        if (table === "incidents") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ingestCiexInboundIssue(
      createRequest(secret, {
        ticket: {
          externalId: "ticket-123",
          title: "Customer cannot sign in",
        },
      }),
      {
        ticket: {
          externalId: "ticket-123",
          title: "Customer cannot sign in",
        },
      },
      adminClient as never,
    );

    expect(result.created).toBe(true);
    expect(result.issue.sourceKind).toBe("ciex");
  });

  it("accepts Authorization Bearer auth for the inbound secret", async () => {
    const secret = "generated-inbound-secret";
    const secretHash = createHash("sha256").update(secret).digest("hex");

    const request = new Request("https://prod-pulse.example.com/api/integrations/ciex/inbound", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        ticket: {
          externalId: "ticket-123",
          title: "Customer cannot sign in",
        },
      }),
    });

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "integrations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createIntegrationRow({ inbound_key_hash: secretHash }),
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          };
        }

        if (table === "external_issues") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: createIssueRow(),
              error: null,
            }),
          };
        }

        if (table === "incidents") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ingestCiexInboundIssue(
      request,
      {
        ticket: {
          externalId: "ticket-123",
          title: "Customer cannot sign in",
        },
      },
      adminClient as never,
    );

    expect(result.created).toBe(true);
    expect(result.issue.sourceKind).toBe("ciex");
  });

  it("updates an existing normalized issue instead of creating a duplicate", async () => {
    let integrationCalls = 0;
    let externalIssueCalls = 0;
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "integrations") {
          integrationCalls += 1;
          if (integrationCalls === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: createIntegrationRow(),
                error: null,
              }),
            };
          }

          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
          };
        }

        if (table === "external_issues") {
          externalIssueCalls += 1;
          if (externalIssueCalls === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: createIssueRow(),
                error: null,
              }),
            };
          }

          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: createIssueRow({ title: "Updated title" }),
              error: null,
            }),
          };
        }

        if (table === "incidents") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ingestCiexInboundIssue(
      createRequest(),
      {
        ticket: {
          externalId: "ticket-123",
          externalKey: "CIEX-123",
          title: "Updated title",
        },
      },
      adminClient as never,
    );

    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
    expect(result.issue.title).toBe("Updated title");
  });

  it("accepts the flat CIEX sender payload and normalizes related refs", async () => {
    let externalIssueCalls = 0;
    const payload = ciexInboundPayloadSchema.parse({
      eventType: "ticket.updated",
      externalId: "ticket-123",
      externalKey: "CIEX-123",
      title: "Customer cannot sign in",
      summary: "Customer reports repeated auth failures.",
      status: "open",
      priority: "high",
      sourceUrl: "javascript:alert(1)",
      customerReference: "Acme Corp",
      relatedAppId: "00000000-0000-0000-0000-000000000001",
      relatedEnvironmentId: "00000000-0000-0000-0000-000000000002",
      relatedMonitorId: "00000000-0000-0000-0000-000000000003",
      sourceCreatedAt: "2026-06-03T15:00:00.000Z",
      sourceUpdatedAt: "2026-06-03T15:01:00.000Z",
    });

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "integrations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createIntegrationRow(),
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          };
        }

        if (table === "monitors") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createScopedLookupRow(
                "00000000-0000-0000-0000-000000000003",
                "00000000-0000-0000-0000-000000000001",
                "00000000-0000-0000-0000-000000000002",
              ),
              error: null,
            }),
          };
        }

        if (table === "external_issues") {
          externalIssueCalls += 1;
          if (externalIssueCalls === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }

          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: createIssueRow({
                source_url: null,
                related_app_id: "00000000-0000-0000-0000-000000000001",
                related_environment_id: "00000000-0000-0000-0000-000000000002",
                related_monitor_id: "00000000-0000-0000-0000-000000000003",
                source_created_at: "2026-06-03T15:00:00.000Z",
                source_updated_at: "2026-06-03T15:01:00.000Z",
              }),
              error: null,
            }),
          };
        }

        if (table === "incidents") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }

        if (table === "incident_external_issues") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ingestCiexInboundIssue(createRequest(), payload, adminClient as never);

    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.issue.sourceUrl).toBeNull();
    expect(result.issue.relatedAppId).toBe("00000000-0000-0000-0000-000000000001");
    expect(result.issue.relatedEnvironmentId).toBe("00000000-0000-0000-0000-000000000002");
    expect(result.issue.relatedMonitorId).toBe("00000000-0000-0000-0000-000000000003");
  });

  it("rejects invalid inbound keys with a safe unauthorized error", async () => {
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "integrations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      ingestCiexInboundIssue(
        createRequest("wrong-secret"),
        {
          ticket: {
            externalId: "ticket-123",
            title: "Customer cannot sign in",
          },
        },
        adminClient as never,
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
  });

  it("rejects cross-org related refs before writing the issue", async () => {
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "integrations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createIntegrationRow(),
              error: null,
            }),
          };
        }

        if (table === "monitored_apps") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      ingestCiexInboundIssue(
        createRequest(),
        {
          ticket: {
            externalId: "ticket-123",
            title: "Customer cannot sign in",
            appId: "app-1",
          },
        },
        adminClient as never,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_RELATION",
    });
  });

  it("returns deterministic incident suggestions from related monitor refs", async () => {
    let externalIssueCalls = 0;

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "integrations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createIntegrationRow(),
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          };
        }

        if (table === "monitors") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createScopedLookupRow("monitor-1", "app-1", "env-1"),
              error: null,
            }),
          };
        }

        if (table === "external_issues") {
          externalIssueCalls += 1;
          if (externalIssueCalls === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }

          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: createIssueRow({
                related_app_id: "app-1",
                related_environment_id: "env-1",
                related_monitor_id: "monitor-1",
              }),
              error: null,
            }),
          };
        }

        if (table === "incidents") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "incident-1",
                  app_id: "app-1",
                  environment_id: "env-1",
                  monitor_id: "monitor-1",
                  status: "open",
                },
                {
                  id: "incident-2",
                  app_id: "app-1",
                  environment_id: "env-1",
                  monitor_id: "monitor-2",
                  status: "open",
                },
              ],
              error: null,
            }),
          };
        }

        if (table === "incident_external_issues") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ingestCiexInboundIssue(
      createRequest(),
      {
        ticket: {
          externalId: "ticket-123",
          title: "Customer cannot sign in",
          monitorId: "monitor-1",
        },
      },
      adminClient as never,
    );

    expect(result.suggestedIncidentIds).toEqual(["incident-1"]);
  });
});
