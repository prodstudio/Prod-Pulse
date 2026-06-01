import { describe, expect, it } from "vitest";

import {
  sanitizeIncidentForAudit,
  sanitizeIncidentText,
  toSafeIncidentDetail,
  type RawIncidentRecord,
} from "@/lib/server/incidents/incident-sanitization";

const rawIncident: RawIncidentRecord = {
  id: "incident-1",
  organizationId: "org-1",
  appId: "app-1",
  environmentId: "env-1",
  monitorId: "monitor-1",
  createdFromResultId: "result-1",
  title: "API outage",
  summary: "Connection string postgres://user:secret@db.internal:5432/prod failed",
  severity: "critical",
  status: "open",
  dedupeKey: "primary_failure",
  assignedTo: null,
  openedBy: null,
  detectedAt: "2026-06-01T00:00:00Z",
  openedAt: "2026-06-01T00:01:00Z",
  acknowledgedAt: null,
  recoveredAt: null,
  resolvedAt: null,
  autoResolveOnRecovery: false,
  rootCause: "<script>alert(1)</script>",
  resolutionNotes: "Authorization=Bearer secret",
  lastStateChangeAt: "2026-06-01T00:01:00Z",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:01:00Z",
};

describe("incident sanitization", () => {
  it("sanitizes freeform incident text before display", () => {
    expect(sanitizeIncidentText("  line one\r\nline two\t\u0000  ")).toBe("line one\nline two");
  });

  it("returns audit-safe incident snapshots without extra internals", () => {
    expect(sanitizeIncidentForAudit(rawIncident)).toEqual(
      expect.objectContaining({
        id: "incident-1",
        dedupeKey: "primary_failure",
        status: "open",
        summary: "Connection string [redacted-connection-url] failed",
        resolutionNotes: "Authorization=[redacted]",
      }),
    );
  });

  it("builds safe detail payloads from already-sanitized related results", () => {
    const detail = toSafeIncidentDetail(
      rawIncident,
      {
        appName: "Tiquer",
        appSlug: "tiquer",
        monitorName: "API health",
        monitorSlug: "api-health",
        environmentName: "Production",
      },
      [
        {
          id: "update-1",
          actorType: "system",
          actorUserId: null,
          statusFrom: "detected",
          statusTo: "open",
          message: "Incident detected.",
          createdAt: "2026-06-01T00:02:00Z",
        },
      ],
      [
        {
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
        },
      ],
    );

    expect(detail).toEqual(
      expect.objectContaining({
        title: "API outage",
        appName: "Tiquer",
        monitorName: "API health",
        latestResults: [
          expect.objectContaining({
            id: "result-1",
            errorSummary: "The endpoint responded with HTTP 503.",
          }),
        ],
      }),
    );
    expect(detail).not.toHaveProperty("metadata");
  });
});
