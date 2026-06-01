import { afterEach, describe, expect, it, vi } from "vitest";

import { hashHeartbeatToken } from "@/lib/server/heartbeats/heartbeat-token";
import {
  createHeartbeat,
  ingestHeartbeatPing,
  listHeartbeatsForOrganization,
} from "@/lib/server/heartbeats/heartbeat-service";
import { persistHeartbeatMonitorExecutionResult } from "@/lib/server/monitoring/result-service";

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
    if (resourceKind === "app") {
      return {
        organizationContext: {
          organization: { id: "org-1" },
        },
        resource: {
          id: resourceId,
          organization_id: "org-1",
          app_id: resourceId,
        },
      };
    }

    if (resourceKind === "environment") {
      return {
        organizationContext: {
          organization: { id: "org-1" },
        },
        resource: {
          id: resourceId,
          organization_id: "org-1",
          app_id: "app-1",
        },
      };
    }

    if (resourceKind === "heartbeat") {
      return {
        organizationContext: {
          organization: { id: "org-1" },
        },
        resource: {
          id: resourceId,
          organization_id: "org-1",
          app_id: "app-1",
          environment_id: "env-1",
          monitor_id: "monitor-1",
          name: "Nightly sync",
          slug: "nightly-sync",
        },
      };
    }

    throw new Error(`Unexpected resource kind: ${resourceKind}`);
  }),
}));

vi.mock("@/lib/server/monitors/monitor-service", () => ({
  getRawMonitorForExecution: vi.fn().mockResolvedValue({
    id: "monitor-1",
    organizationId: "org-1",
    appId: "app-1",
    environmentId: "env-1",
    name: "Nightly sync heartbeat",
    slug: "nightly-sync-heartbeat",
    type: "heartbeat",
    status: "unknown",
    isEnabled: true,
    requestMethod: "GET",
    targetUrl: null,
    expectedStatusCodes: [200],
    intervalSeconds: 300,
    nextCheckAt: "2026-06-01T03:00:00Z",
    timeoutMs: 10000,
    latencyThresholdMs: null,
    consecutiveFailureThreshold: 3,
    consecutiveRecoveryThreshold: 2,
    configuration: {},
    description: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  }),
  getRawMonitorByIdForOrganization: vi.fn().mockResolvedValue({
    id: "monitor-1",
    organizationId: "org-1",
    appId: "app-1",
    environmentId: "env-1",
    name: "Nightly sync heartbeat",
    slug: "nightly-sync-heartbeat",
    type: "heartbeat",
    status: "unknown",
    isEnabled: true,
    requestMethod: "GET",
    targetUrl: null,
    expectedStatusCodes: [200],
    intervalSeconds: 300,
    nextCheckAt: "2026-06-01T03:00:00Z",
    timeoutMs: 10000,
    latencyThresholdMs: null,
    consecutiveFailureThreshold: 3,
    consecutiveRecoveryThreshold: 2,
    configuration: {},
    description: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  }),
}));

vi.mock("@/lib/server/monitoring/result-service", () => ({
  persistHeartbeatMonitorExecutionResult: vi.fn().mockResolvedValue({
    result: {
      id: "result-1",
      status: "success",
      triggerSource: "heartbeat",
      checkedAt: "2026-06-01T03:03:00Z",
      durationMs: 0,
      httpStatus: null,
      errorCode: null,
      errorSummary: null,
      responseSummary: null,
      assertionSummary: null,
      metadataSummary: "Heartbeat fresh",
    },
    duplicate: false,
  }),
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

function createValidHeartbeatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "heartbeat-1",
    organization_id: "org-1",
    app_id: "app-1",
    environment_id: "env-1",
    monitor_id: "monitor-1",
    name: "Nightly sync",
    slug: "nightly-sync",
    expected_interval_seconds: 300,
    grace_seconds: 120,
    token_hash: "hashed-token",
    token_hint: "...secret",
    is_enabled: true,
    status: "operational",
    last_seen_at: "2026-06-01T03:00:00Z",
    last_payload: { status: "ok" },
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("heartbeat service", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns only safe heartbeat payloads on list", async () => {
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "heartbeats") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [createValidHeartbeatRow({ token_hash: "secret-hash" })],
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const heartbeats = await listHeartbeatsForOrganization(
      "user-1",
      "org-1",
      adminClient as never,
    );

    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0]).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(heartbeats[0])).not.toContain("secret-hash");
  });

  it("creates a heartbeat with a one-time raw token while keeping the stored payload safe", async () => {
    const heartbeatsInsertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: createValidHeartbeatRow(),
        error: null,
      }),
    };

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "heartbeats") {
          const callCount = adminClient.from.mock.calls.filter(([name]) => name === "heartbeats").length;
          if (callCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }

          return heartbeatsInsertChain;
        }

        if (table === "monitors") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { configuration: {} },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const created = await createHeartbeat(
      createContext(),
      {
        appId: "app-1",
        environmentId: "env-1",
        monitorId: "monitor-1",
        name: "Nightly sync",
        slug: "nightly-sync",
        expectedIntervalSeconds: 300,
        graceSeconds: 120,
        isEnabled: true,
      },
      adminClient as never,
    );

    expect(created.rawToken).toHaveLength(43);
    expect(created.heartbeat).not.toHaveProperty("tokenHash");
    expect(created.heartbeat.tokenHint).toMatch(/^\.\.\.[A-Za-z0-9_-]{6}$/);
  });

  it("rejects invalid and disabled tokens safely", async () => {
    const invalidClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    };

    await expect(
      ingestHeartbeatPing(
        "missing-token",
        new Request("https://example.com/api/heartbeats/missing-token", {
          method: "POST",
          body: "{}",
        }),
        invalidClient as never,
      ),
    ).rejects.toMatchObject({ status: 404 });

    const disabledClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: createValidHeartbeatRow({
            token_hash: hashHeartbeatToken("test-heartbeat-token"),
            is_enabled: false,
          }),
          error: null,
        }),
      })),
    };

    await expect(
      ingestHeartbeatPing(
        "test-heartbeat-token",
        new Request("https://example.com/api/heartbeats/test-heartbeat-token", {
          method: "POST",
          body: "{}",
        }),
        disabledClient as never,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects oversized heartbeat payloads", async () => {
    const token = "test-heartbeat-token";
    const adminClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: createValidHeartbeatRow({
            token_hash: hashHeartbeatToken(token),
          }),
          error: null,
        }),
      })),
    };

    await expect(
      ingestHeartbeatPing(
        token,
        new Request(`https://example.com/api/heartbeats/${token}`, {
          method: "POST",
          headers: {
            "content-length": "5000",
          },
          body: JSON.stringify({ message: "x".repeat(5000) }),
        }),
        adminClient as never,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("accepts a valid ping, updates last_seen_at, and writes a linked monitor result", async () => {
    const token = "test-heartbeat-token";
    const updates: Array<Record<string, unknown>> = [];
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "heartbeats") {
          const updateChain = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: createValidHeartbeatRow({
                token_hash: hashHeartbeatToken(token),
                last_seen_at: "2026-06-01T03:05:00Z",
                last_payload: {
                  service: "tiquer-worker",
                  jobName: "nightly-sync",
                  runId: "run-1",
                  status: "ok",
                  message: "Completed successfully",
                },
              }),
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createValidHeartbeatRow({
                token_hash: hashHeartbeatToken(token),
              }),
              error: null,
            }),
          };

          const baseChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: createValidHeartbeatRow({
                token_hash: hashHeartbeatToken(token),
              }),
              error: null,
            }),
            update: vi.fn((patch: Record<string, unknown>) => {
              updates.push(patch);
              return updateChain;
            }),
          };

          return baseChain;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ingestHeartbeatPing(
      token,
      new Request(`https://example.com/api/heartbeats/${token}`, {
        method: "POST",
        body: JSON.stringify({
          service: "tiquer-worker",
          jobName: "nightly-sync",
          runId: "run-1",
          status: "ok",
          message: "Completed successfully",
        }),
      }),
      adminClient as never,
    );

    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({
      status: "operational",
    });
    expect(persistHeartbeatMonitorExecutionResult).toHaveBeenCalled();
  });
});
