import { describe, expect, it, vi } from "vitest";

import {
  createNotificationChannel,
  listNotificationChannelsForOrganization,
} from "@/lib/server/alerts/notification-channel-service";

vi.mock("@/lib/server/audit/audit-log", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
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

function createMembershipChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: [
        {
          id: "membership-1",
          organization_id: "org-1",
          user_id: "user-1",
          role: "admin",
          disabled_at: null,
          created_at: "2026-06-01T00:00:00Z",
          organizations: {
            id: "org-1",
            name: "Prod Studio",
            slug: "prod-studio",
            is_active: true,
          },
        },
      ],
      error: null,
    }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "membership-1",
        organization_id: "org-1",
        user_id: "user-1",
        role: "admin",
        disabled_at: null,
        created_at: "2026-06-01T00:00:00Z",
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

describe("notification channel service", () => {
  it("creates a Slack channel without exposing the raw webhook URL", async () => {
    process.env.APP_ENCRYPTION_KEY = "local-test-key";

    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: "channel-1",
          organization_id: "org-1",
          name: "Primary",
          type: "slack",
          is_enabled: true,
          masked_destination: "hooks.slack.com/.../mnop",
          encrypted_config: "encrypted-payload",
          last_tested_at: null,
          last_test_status: null,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
        },
        error: null,
      }),
    };

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "notification_channels") {
          return insertChain;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const channel = await createNotificationChannel(
      createContext(),
      {
        name: "Primary",
        type: "slack",
        isEnabled: true,
        webhookUrl: "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop",
      },
      adminClient as never,
    );

    expect(channel).toMatchObject({
      id: "channel-1",
      maskedDestination: "hooks.slack.com/.../mnop",
    });
    expect(channel).not.toHaveProperty("encryptedConfig");
    expect(JSON.stringify(channel)).not.toContain("hooks.slack.com/services/T000/B000/abcdefghijklmnop");
  });

  it("lists only safe channel payloads", async () => {
    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "memberships") {
          return createMembershipChain();
        }

        if (table === "notification_channels") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "channel-1",
                  organization_id: "org-1",
                  name: "Primary",
                  type: "slack",
                  is_enabled: true,
                  masked_destination: "hooks.slack.com/.../mnop",
                  encrypted_config: "secret",
                  last_tested_at: null,
                  last_test_status: null,
                  created_at: "2026-06-01T00:00:00Z",
                  updated_at: "2026-06-01T00:00:00Z",
                },
              ],
              error: null,
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const channels = await listNotificationChannelsForOrganization(
      "user-1",
      "org-1",
      adminClient as never,
    );

    expect(channels).toHaveLength(1);
    expect(channels[0]).not.toHaveProperty("encryptedConfig");
  });
});
