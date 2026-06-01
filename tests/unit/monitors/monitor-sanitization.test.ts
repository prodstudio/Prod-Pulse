import { describe, expect, it } from "vitest";

import {
  sanitizeMonitorForAudit,
  toSafeMonitorDetail,
  type RawMonitorRecord,
} from "@/lib/server/monitors/monitor-sanitization";

const rawMonitor: RawMonitorRecord = {
  id: "monitor-1",
  organizationId: "org-1",
  appId: "app-1",
  environmentId: "env-1",
  name: "Prod API health",
  slug: "prod-api-health",
  type: "api_health",
  status: "unknown",
  isEnabled: true,
  requestMethod: "GET",
  targetUrl: "https://user:pass@example.com/api/health?token=super-secret",
  expectedStatusCodes: [200],
  intervalSeconds: 300,
  nextCheckAt: "2026-05-29T00:00:00Z",
  timeoutMs: 10000,
  latencyThresholdMs: 500,
  consecutiveFailureThreshold: 3,
  consecutiveRecoveryThreshold: 2,
  configuration: {
    headers: {
      Authorization: "Bearer super-secret",
    },
    assertion: {
      path: "$.checks.database.status",
      expected: "ok",
    },
  },
  description: "Checks production health endpoint.",
  createdAt: "2026-05-29T00:00:00Z",
  updatedAt: "2026-05-29T00:00:00Z",
};

describe("monitor sanitization", () => {
  it("does not expose raw configuration in safe payloads", () => {
    const safeMonitor = toSafeMonitorDetail(rawMonitor);

    expect(safeMonitor).not.toHaveProperty("configuration");
    expect(safeMonitor).not.toHaveProperty("targetUrl");
    expect(safeMonitor.targetSummary).toBe("https://example.com/api/health");
    expect(safeMonitor.hasStoredConfiguration).toBe(true);
    expect(safeMonitor.configurationSummary).toContain("stored server-side");
  });

  it("omits raw configuration from audit sanitization", () => {
    const safeAuditRecord = sanitizeMonitorForAudit(rawMonitor);

    expect(safeAuditRecord).not.toHaveProperty("configuration");
    expect(safeAuditRecord.targetSummary).toBe("https://example.com/api/health");
    expect(JSON.stringify(safeAuditRecord)).not.toContain("super-secret");
  });
});
