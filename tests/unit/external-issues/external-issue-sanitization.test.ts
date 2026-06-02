import { describe, expect, it } from "vitest";

import {
  sanitizeExternalIssueForAudit,
  sanitizeExternalIssueSourceKind,
  toSafeExternalIssue,
  type RawExternalIssueRecord,
} from "@/lib/server/external-issues/external-issue-sanitization";

const rawIssue: RawExternalIssueRecord = {
  id: "issue-1",
  organizationId: "org-1",
  integrationId: null,
  sourceKind: "CIEX Portal",
  externalId: " ticket-123 ",
  externalKey: "CIEX-123",
  title: "Customer cannot sign in",
  status: "open",
  priority: "high",
  sourceUrl: "https://ciex.example.com/tickets/123",
  customerReference: "Acme Corp",
  summary: "Authorization=Bearer secret and postgres://user:secret@db.internal/prod",
  createdBy: "user-1",
  createdAt: "2026-06-02T00:00:00Z",
  updatedAt: "2026-06-02T00:05:00Z",
  linkedAt: "2026-06-02T00:06:00Z",
};

describe("external issue sanitization", () => {
  it("normalizes source kinds safely", () => {
    expect(sanitizeExternalIssueSourceKind("CIEX Portal")).toBe("ciex_portal");
  });

  it("builds safe external issue payloads", () => {
    expect(toSafeExternalIssue(rawIssue)).toEqual(
      expect.objectContaining({
        id: "issue-1",
        sourceKind: "ciex_portal",
        externalId: "ticket-123",
        sourceUrl: "https://ciex.example.com/tickets/123",
        summary: "Authorization=[redacted] and [redacted-connection-url]",
      }),
    );
  });

  it("produces audit-safe snapshots without raw secrets", () => {
    expect(sanitizeExternalIssueForAudit(rawIssue)).toEqual(
      expect.objectContaining({
        externalKey: "CIEX-123",
        summary: "Authorization=[redacted] and [redacted-connection-url]",
      }),
    );
  });
});
