import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => {
    throw new Error("createSupabaseAdminClient should not be used in this test");
  }),
}));

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/server/api/errors", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    details?: Record<string, unknown> | string;

    constructor(
      status: number,
      code: string,
      message: string,
      details?: Record<string, unknown> | string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  return {
    ApiError,
    mapPostgresError: vi.fn(
      (error: { code?: string; message: string }) =>
        new ApiError(500, error.code ?? "request_failed", error.message),
    ),
  };
});

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
      createdAt: "2026-06-02T00:00:00Z",
    },
  }),
}));

import {
  createCiexIntegration,
  disableCiexIntegration,
  enableCiexIntegration,
  rotateCiexIntegrationKey,
} from "@/lib/server/integrations/ciex-config-service";

function createContext(role: "owner" | "admin" = "admin") {
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
      role,
      createdAt: "2026-06-02T00:00:00Z",
    },
  };
}

function createAdminClient() {
  let integrationRow: Record<string, unknown> | null = null;
  let lastInsertedIntegration: Record<string, unknown> | null = null;

  const adminClient = {
    from: vi.fn((table: string) => {
      if (table === "memberships") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "membership-1",
              organization_id: "org-1",
              user_id: "user-1",
              role: "admin",
              disabled_at: null,
              created_at: "2026-06-02T00:00:00Z",
              organizations: {
                id: "org-1",
                name: "Prod Studio",
                slug: "prod-studio",
                is_active: true,
              },
            },
            error: null,
          }),
        };
      }

      if (table === "integrations") {
        const filters: Record<string, unknown> = {};
        let pendingInsert: Record<string, unknown> | null = null;
        let pendingUpdate: Record<string, unknown> | null = null;

        const chain = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn((payload: Record<string, unknown>) => {
            pendingInsert = payload;
            return chain;
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            pendingUpdate = payload;
            return chain;
          }),
          eq: vi.fn((field: string, value: unknown) => {
            filters[field] = value;
            return chain;
          }),
          maybeSingle: vi.fn().mockImplementation(async () => {
            if (!integrationRow) {
              return { data: null, error: null };
            }

            if (filters.organization_id && integrationRow.organization_id !== filters.organization_id) {
              return { data: null, error: null };
            }

            if (filters.kind && integrationRow.kind !== filters.kind) {
              return { data: null, error: null };
            }

            if (filters.inbound_key_hash && integrationRow.inbound_key_hash !== filters.inbound_key_hash) {
              return { data: null, error: null };
            }

            return { data: integrationRow, error: null };
          }),
          single: vi.fn().mockImplementation(async () => {
            if (pendingInsert) {
              integrationRow = {
                id: "integration-1",
                organization_id: String(pendingInsert.organization_id),
                kind: String(pendingInsert.kind),
                name: String(pendingInsert.name),
                is_enabled: Boolean(pendingInsert.is_enabled),
                inbound_key_hash: pendingInsert.inbound_key_hash ?? null,
                inbound_key_hint: pendingInsert.inbound_key_hint ?? null,
                last_inbound_at: null,
                created_at: "2026-06-02T00:00:00Z",
                updated_at: "2026-06-02T00:00:00Z",
              };
              lastInsertedIntegration = integrationRow;
              return { data: integrationRow, error: null };
            }

            if (pendingUpdate) {
              integrationRow = {
                ...integrationRow,
                ...pendingUpdate,
                updated_at: "2026-06-02T00:10:00Z",
              };
              return { data: integrationRow, error: null };
            }

            return { data: integrationRow, error: null };
          }),
        };

        return chain;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    adminClient,
    getIntegrationRow: () => integrationRow,
    getLastInsertedIntegration: () => lastInsertedIntegration,
  };
}

describe("ciex config service", () => {
  it("creates an integration secret and stores only hash and hint", async () => {
    const state = createAdminClient();

    const result = await createCiexIntegration(createContext(), state.adminClient as never);
    const stored = state.getLastInsertedIntegration();

    expect(result.plaintextSecret.length).toBeGreaterThan(20);
    expect(result.integration.inboundKeyHint).toMatch(/^\*{4}/);
    expect((result.integration as Record<string, unknown>).inbound_key_hash).toBeUndefined();
    expect(stored?.inbound_key_hash).toBe(
      createHash("sha256").update(result.plaintextSecret).digest("hex"),
    );
    expect(stored?.inbound_key_hash).not.toBe(result.plaintextSecret);
    expect(stored?.inbound_key_hint).toBe(result.integration.inboundKeyHint);
  });

  it("rotates the key, changes hash and hint, and returns plaintext once", async () => {
    const state = createAdminClient();
    const created = await createCiexIntegration(createContext(), state.adminClient as never);
    const before = state.getIntegrationRow();

    const rotated = await rotateCiexIntegrationKey(createContext(), state.adminClient as never);
    const after = state.getIntegrationRow();

    expect(rotated.plaintextSecret).not.toBe(created.plaintextSecret);
    expect(after?.inbound_key_hash).toBe(
      createHash("sha256").update(rotated.plaintextSecret).digest("hex"),
    );
    expect(after?.inbound_key_hash).not.toBe(before?.inbound_key_hash);
    expect(after?.inbound_key_hint).not.toBe(before?.inbound_key_hint);
    expect((rotated.integration as Record<string, unknown>).inbound_key_hash).toBeUndefined();
  });

  it("disabling blocks inbound use until re-enabled", async () => {
    const state = createAdminClient();
    await createCiexIntegration(createContext(), state.adminClient as never);

    const disabled = await disableCiexIntegration(createContext(), state.adminClient as never);
    expect(disabled.isEnabled).toBe(false);
    expect(state.getIntegrationRow()?.is_enabled).toBe(false);

    const enabled = await enableCiexIntegration(createContext(), state.adminClient as never);
    expect(enabled.isEnabled).toBe(true);
    expect(state.getIntegrationRow()?.is_enabled).toBe(true);
  });
});
