import { describe, expect, it, vi } from "vitest";

import { processScheduledIncidentState } from "@/lib/server/incidents/incident-engine";
import type { RunnerMonitorRecord } from "@/lib/server/monitoring/runner-locks";
import type { SafeMonitorResult } from "@/lib/server/monitoring/result-sanitization";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

function createMonitor(overrides: Partial<RunnerMonitorRecord> = {}): RunnerMonitorRecord {
  return {
    id: "monitor-1",
    organizationId: "org-1",
    appId: "app-1",
    environmentId: "env-1",
    name: "API health",
    slug: "api-health",
    type: "http",
    status: "down",
    isEnabled: true,
    requestMethod: "GET",
    targetUrl: "https://example.com/health",
    expectedStatusCodes: [200],
    intervalSeconds: 300,
    nextCheckAt: "2026-06-01T00:00:00Z",
    timeoutMs: 10000,
    latencyThresholdMs: null,
    consecutiveFailureThreshold: 3,
    consecutiveRecoveryThreshold: 2,
    consecutiveFailures: 2,
    consecutiveSuccesses: 0,
    configuration: {},
    description: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastScheduledBucket: null,
    lockedAt: null,
    lockExpiresAt: null,
    lockedByRunId: null,
    ...overrides,
  };
}

function createResult(overrides: Partial<SafeMonitorResult> = {}): SafeMonitorResult {
  return {
    id: "result-1",
    status: "failure",
    triggerSource: "scheduled",
    checkedAt: "2026-06-01T00:00:00Z",
    durationMs: 1000,
    httpStatus: 503,
    errorCode: "HTTP_503",
    errorSummary: "The endpoint responded with HTTP 503.",
    responseSummary: null,
    assertionSummary: null,
    metadataSummary: null,
    ...overrides,
  };
}

function createIncidentSelectChain(result: { data: unknown; error: null }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

function createIncidentInsertChain(result: { data: unknown; error: null | { code?: string; message: string } }) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

function createIncidentUpdateChain() {
  const chain = {
    update: vi.fn(),
    eq: vi.fn(),
  };

  chain.update.mockReturnValue(chain);
  chain.eq.mockImplementation(() => {
    if (chain.eq.mock.calls.length >= 2) {
      return Promise.resolve({ error: null });
    }

    return chain;
  });

  return chain;
}

function createStatusChain(rows: Array<{ id: string; status: string }>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
}

function createIncidentUpdatesInsert() {
  return {
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
}

describe("incident engine", () => {
  it("creates an incident only after the failure threshold is reached", async () => {
    const monitor = createMonitor({ consecutiveFailureThreshold: 3 });
    const result = createResult();
    const statusChain = createStatusChain([
      { id: "result-1", status: "failure" },
      { id: "result-0", status: "failure" },
    ]);
    const unresolvedChain = createIncidentSelectChain({ data: null, error: null });
    const incidentInsert = createIncidentInsertChain({
      data: {
        id: "incident-1",
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
        created_from_result_id: "result-1",
        title: "API health is down",
        summary: "The endpoint responded with HTTP 503.",
        severity: "critical",
        status: "detected",
        dedupe_key: "primary_failure",
        assigned_to: null,
        opened_by: null,
        detected_at: "2026-06-01T00:00:00Z",
        opened_at: null,
        acknowledged_at: null,
        recovered_at: null,
        resolved_at: null,
        auto_resolve_on_recovery: false,
        root_cause: null,
        resolution_notes: null,
        last_state_change_at: "2026-06-01T00:00:00Z",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      error: null,
    });

    const noCreateClient = {
      from: vi.fn((table: string) => {
        if (table === "monitor_results") {
          return statusChain;
        }
        if (table === "incidents") {
          return unresolvedChain;
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const beforeThreshold = await processScheduledIncidentState(
      { monitor, result },
      noCreateClient as never,
    );

    expect(beforeThreshold).toMatchObject({ action: "noop", created: false });

    const createClient = {
      from: vi.fn((table: string) => {
        if (table === "monitor_results") {
          return createStatusChain([
            { id: "result-1", status: "failure" },
            { id: "result-0", status: "failure" },
            { id: "result--1", status: "failure" },
          ]);
        }
        if (table === "incidents") {
          return createClient.from.mock.calls.length === 2 ? unresolvedChain : incidentInsert;
        }
        if (table === "incident_updates") {
          return createIncidentUpdatesInsert();
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const created = await processScheduledIncidentState(
      { monitor, result },
      createClient as never,
    );

    expect(created).toMatchObject({ action: "created", created: true, incidentId: "incident-1" });
  });

  it("does not create a duplicate unresolved incident for repeated failures", async () => {
    const existingIncident = {
      id: "incident-1",
      organization_id: "org-1",
      app_id: "app-1",
      environment_id: "env-1",
      monitor_id: "monitor-1",
      created_from_result_id: "result-0",
      title: "API health is down",
      summary: "The endpoint responded with HTTP 503.",
      severity: "critical",
      status: "detected",
      dedupe_key: "primary_failure",
      assigned_to: null,
      opened_by: null,
      detected_at: "2026-06-01T00:00:00Z",
      opened_at: null,
      acknowledged_at: null,
      recovered_at: null,
      resolved_at: null,
      auto_resolve_on_recovery: false,
      root_cause: null,
      resolution_notes: null,
      last_state_change_at: "2026-06-01T00:00:00Z",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    };
    const incidentUpdateChain = createIncidentUpdateChain();

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "monitor_results") {
          return createStatusChain([
            { id: "result-1", status: "failure" },
            { id: "result-0", status: "failure" },
            { id: "result--1", status: "failure" },
          ]);
        }
        if (table === "incidents") {
          return adminClient.from.mock.calls.length === 2
            ? createIncidentSelectChain({ data: existingIncident, error: null })
            : incidentUpdateChain;
        }
        if (table === "incident_updates") {
          return createIncidentUpdatesInsert();
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const outcome = await processScheduledIncidentState(
      { monitor: createMonitor(), result: createResult() },
      adminClient as never,
    );

    expect(outcome).toMatchObject({ created: false, updated: true, action: "opened" });
  });

  it("uses the current result trigger source when evaluating manual incident automation", async () => {
    const triggerEqCalls: string[] = [];
    const incidentInsert = createIncidentInsertChain({
      data: {
        id: "incident-manual-1",
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
        created_from_result_id: "result-manual-1",
        title: "API health is down",
        summary: "The endpoint responded with HTTP 503.",
        severity: "critical",
        status: "detected",
        dedupe_key: "primary_failure",
        assigned_to: null,
        opened_by: null,
        detected_at: "2026-06-01T00:00:00Z",
        opened_at: null,
        acknowledged_at: null,
        recovered_at: null,
        resolved_at: null,
        auto_resolve_on_recovery: false,
        root_cause: null,
        resolution_notes: null,
        last_state_change_at: "2026-06-01T00:00:00Z",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      error: null,
    });

    const statusChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((column: string, value: string) => {
        if (column === "trigger_source") {
          triggerEqCalls.push(value);
        }
        return statusChain;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ id: "result-manual-1", status: "failure" }],
        error: null,
      }),
    };

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "monitor_results") {
          return statusChain;
        }
        if (table === "incidents") {
          return adminClient.from.mock.calls.length === 2
            ? createIncidentSelectChain({ data: null, error: null })
            : incidentInsert;
        }
        if (table === "incident_updates") {
          return createIncidentUpdatesInsert();
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const outcome = await processScheduledIncidentState(
      {
        monitor: createMonitor({ consecutiveFailureThreshold: 1 }),
        result: createResult({
          id: "result-manual-1",
          triggerSource: "manual",
        }),
      },
      adminClient as never,
    );

    expect(outcome).toMatchObject({
      created: true,
      action: "created",
      incidentId: "incident-manual-1",
    });
    expect(triggerEqCalls).toContain("manual");
  });

  it("allows a future incident after the prior one is resolved", async () => {
    const statusRows = [
      { id: "result-2", status: "failure" },
      { id: "result-1", status: "failure" },
      { id: "result-0", status: "failure" },
    ];
    const incidentInsert = createIncidentInsertChain({
      data: {
        id: "incident-2",
        organization_id: "org-1",
        app_id: "app-1",
        environment_id: "env-1",
        monitor_id: "monitor-1",
        created_from_result_id: "result-2",
        title: "API health is down",
        summary: "The endpoint responded with HTTP 503.",
        severity: "critical",
        status: "detected",
        dedupe_key: "primary_failure",
        assigned_to: null,
        opened_by: null,
        detected_at: "2026-06-01T00:05:00Z",
        opened_at: null,
        acknowledged_at: null,
        recovered_at: null,
        resolved_at: null,
        auto_resolve_on_recovery: false,
        root_cause: null,
        resolution_notes: null,
        last_state_change_at: "2026-06-01T00:05:00Z",
        created_at: "2026-06-01T00:05:00Z",
        updated_at: "2026-06-01T00:05:00Z",
      },
      error: null,
    });

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "monitor_results") {
          return createStatusChain(statusRows);
        }
        if (table === "incidents") {
          return adminClient.from.mock.calls.length === 2
            ? createIncidentSelectChain({ data: null, error: null })
            : incidentInsert;
        }
        if (table === "incident_updates") {
          return createIncidentUpdatesInsert();
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const outcome = await processScheduledIncidentState(
      { monitor: createMonitor(), result: createResult({ id: "result-2", checkedAt: "2026-06-01T00:05:00Z" }) },
      adminClient as never,
    );

    expect(outcome).toMatchObject({ created: true, incidentId: "incident-2" });
  });

  it("moves incidents to monitoring or resolved on recovery", async () => {
    const baseIncident = {
      id: "incident-1",
      organization_id: "org-1",
      app_id: "app-1",
      environment_id: "env-1",
      monitor_id: "monitor-1",
      created_from_result_id: "result-0",
      title: "API health is down",
      summary: "The endpoint responded with HTTP 503.",
      severity: "critical",
      status: "open",
      dedupe_key: "primary_failure",
      assigned_to: null,
      opened_by: null,
      detected_at: "2026-06-01T00:00:00Z",
      opened_at: "2026-06-01T00:01:00Z",
      acknowledged_at: null,
      recovered_at: null,
      resolved_at: null,
      auto_resolve_on_recovery: false,
      root_cause: null,
      resolution_notes: null,
      last_state_change_at: "2026-06-01T00:01:00Z",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:01:00Z",
    };

    const monitoringClient = {
      from: vi.fn((table: string) => {
        if (table === "monitor_results") {
          return createStatusChain([
            { id: "result-2", status: "success" },
            { id: "result-1", status: "success" },
          ]);
        }
        if (table === "incidents") {
          return monitoringClient.from.mock.calls.length === 2
            ? createIncidentSelectChain({ data: baseIncident, error: null })
            : createIncidentUpdateChain();
        }
        if (table === "incident_updates") {
          return createIncidentUpdatesInsert();
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const monitoringOutcome = await processScheduledIncidentState(
      { monitor: createMonitor({ consecutiveRecoveryThreshold: 2 }), result: createResult({ status: "success", errorCode: null, httpStatus: 200 }) },
      monitoringClient as never,
    );

    expect(monitoringOutcome).toMatchObject({ updated: true, action: "monitoring" });

    const resolvedClient = {
      from: vi.fn((table: string) => {
        if (table === "monitor_results") {
          return createStatusChain([
            { id: "result-2", status: "success" },
            { id: "result-1", status: "success" },
          ]);
        }
        if (table === "incidents") {
          return resolvedClient.from.mock.calls.length === 2
            ? createIncidentSelectChain({
                data: { ...baseIncident, auto_resolve_on_recovery: true },
                error: null,
              })
            : createIncidentUpdateChain();
        }
        if (table === "incident_updates") {
          return createIncidentUpdatesInsert();
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const resolvedOutcome = await processScheduledIncidentState(
      { monitor: createMonitor({ consecutiveRecoveryThreshold: 2 }), result: createResult({ status: "success", errorCode: null, httpStatus: 200 }) },
      resolvedClient as never,
    );

    expect(resolvedOutcome).toMatchObject({ updated: true, action: "resolved" });
  });
});
