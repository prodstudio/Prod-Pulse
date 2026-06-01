import "server-only";

import { z } from "zod";

import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import type { ActiveOrganizationContext } from "@/lib/server/auth/organization-context";
import {
  requireOrgMembership,
  requireResourceAccess,
} from "@/lib/server/auth/organization-context";
import {
  maskSlackWebhookUrl,
  sanitizeNotificationChannelForAudit,
  toSafeNotificationChannel,
  type SafeNotificationChannel,
} from "@/lib/server/alerts/alert-sanitization";
import { decryptAlertConfig, encryptAlertConfig } from "@/lib/server/alerts/channel-crypto";
import { sendSlackNotification } from "@/lib/server/alerts/slack";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type NotificationChannelServiceContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

type RawNotificationChannelRecord = {
  id: string;
  organizationId: string;
  name: string;
  type: "slack" | "email" | "whatsapp";
  isEnabled: boolean;
  maskedDestination: string | null;
  encryptedConfig: string | null;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

type SlackChannelConfig = {
  webhookUrl: string;
};

const CHANNEL_SELECT = [
  "id",
  "organization_id",
  "name",
  "type",
  "is_enabled",
  "masked_destination",
  "encrypted_config",
  "last_tested_at",
  "last_test_status",
  "created_at",
  "updated_at",
].join(", ");

const slackWebhookSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => value.startsWith("https://hooks.slack.com/"), {
    message: "Slack webhook URLs must use hooks.slack.com.",
  });

export const createNotificationChannelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.literal("slack"),
  isEnabled: z.boolean().optional().default(true),
  webhookUrl: slackWebhookSchema,
});

export const updateNotificationChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    isEnabled: z.boolean().optional(),
    webhookUrl: slackWebhookSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

function mapChannelRow(row: Record<string, unknown>): RawNotificationChannelRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    type: String(row.type) as RawNotificationChannelRecord["type"],
    isEnabled: Boolean(row.is_enabled),
    maskedDestination: (row.masked_destination as string | null) ?? null,
    encryptedConfig: (row.encrypted_config as string | null) ?? null,
    lastTestedAt: (row.last_tested_at as string | null) ?? null,
    lastTestStatus: (row.last_test_status as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function getRawNotificationChannelById(
  userId: string,
  channelId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { resource } = await requireResourceAccess(
    userId,
    "notification_channel",
    channelId,
    organizationId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("notification_channels")
    .select(CHANNEL_SELECT)
    .eq("id", resource.id)
    .eq("organization_id", resource.organization_id)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  return mapChannelRow(data as unknown as Record<string, unknown>);
}

export async function listNotificationChannelsForOrganization(
  userId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeNotificationChannel[]> {
  const organizationContext = await requireOrgMembership(userId, organizationId, adminClient);

  const { data, error } = await adminClient
    .from("notification_channels")
    .select(CHANNEL_SELECT)
    .eq("organization_id", organizationContext.organization.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw mapPostgresError(error);
  }

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) =>
    toSafeNotificationChannel(mapChannelRow(row)),
  );
}

export async function getNotificationChannelById(
  userId: string,
  channelId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  return toSafeNotificationChannel(
    await getRawNotificationChannelById(userId, channelId, organizationId, adminClient),
  );
}

export async function createNotificationChannel(
  context: NotificationChannelServiceContext,
  input: z.infer<typeof createNotificationChannelSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const encryptedConfig = encryptAlertConfig({
    webhookUrl: input.webhookUrl,
  });

  const { data, error } = await adminClient
    .from("notification_channels")
    .insert({
      organization_id: context.organization.id,
      name: input.name,
      type: input.type,
      is_enabled: input.isEnabled,
      masked_destination: maskSlackWebhookUrl(input.webhookUrl),
      encrypted_config: encryptedConfig,
      created_by: context.userId,
    })
    .select(CHANNEL_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const channel = mapChannelRow(data as unknown as Record<string, unknown>);

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "notification_channels",
    targetId: channel.id,
    metadata: {
      channel: sanitizeNotificationChannelForAudit(channel),
    },
    request: context.request,
  });

  return toSafeNotificationChannel(channel);
}

export async function updateNotificationChannel(
  context: NotificationChannelServiceContext,
  channelId: string,
  input: z.infer<typeof updateNotificationChannelSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const before = await getRawNotificationChannelById(
    context.userId,
    channelId,
    context.organization.id,
    adminClient,
  );

  const patch: Record<string, unknown> = {};

  if (typeof input.name === "string") {
    patch.name = input.name;
  }

  if (typeof input.isEnabled === "boolean") {
    patch.is_enabled = input.isEnabled;
  }

  if (typeof input.webhookUrl === "string") {
    patch.encrypted_config = encryptAlertConfig({
      webhookUrl: input.webhookUrl,
    });
    patch.masked_destination = maskSlackWebhookUrl(input.webhookUrl);
  }

  const { data, error } = await adminClient
    .from("notification_channels")
    .update(patch)
    .eq("id", before.id)
    .eq("organization_id", before.organizationId)
    .select(CHANNEL_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const after = mapChannelRow(data as unknown as Record<string, unknown>);

  await writeAuditLog({
    organizationId: before.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: typeof input.webhookUrl === "string" ? "rotate_secret" : "update",
    targetTable: "notification_channels",
    targetId: before.id,
    metadata: {
      before: sanitizeNotificationChannelForAudit(before),
      after: sanitizeNotificationChannelForAudit(after),
    },
    request: context.request,
  });

  return toSafeNotificationChannel(after);
}

export async function deleteNotificationChannel(
  context: NotificationChannelServiceContext,
  channelId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const channel = await getRawNotificationChannelById(
    context.userId,
    channelId,
    context.organization.id,
    adminClient,
  );

  const { error } = await adminClient
    .from("notification_channels")
    .delete()
    .eq("id", channel.id)
    .eq("organization_id", channel.organizationId);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: channel.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "delete",
    targetTable: "notification_channels",
    targetId: channel.id,
    metadata: {
      deleted: sanitizeNotificationChannelForAudit(channel),
    },
    request: context.request,
  });
}

export async function getNotificationChannelConfigForDelivery(
  organizationId: string,
  channelId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { data, error } = await adminClient
    .from("notification_channels")
    .select(CHANNEL_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", channelId)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  const channel = mapChannelRow(data as unknown as Record<string, unknown>);
  const decrypted = decryptAlertConfig<SlackChannelConfig>(channel.encryptedConfig);

  return {
    channel,
    config: decrypted,
  };
}

export async function sendNotificationChannelTest(
  context: NotificationChannelServiceContext,
  channelId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { channel, config } = await getNotificationChannelConfigForDelivery(
    context.organization.id,
    channelId,
    adminClient,
  );

  if (channel.type !== "slack" || !config?.webhookUrl) {
    throw new ApiError(400, "request_failed", "The request could not be completed.");
  }

  const scheduledAt = new Date().toISOString();
  const { data: deliveryData, error: deliveryError } = await adminClient
    .from("alert_deliveries")
    .insert({
      organization_id: channel.organizationId,
      incident_id: null,
      monitor_id: null,
      alert_rule_id: null,
      notification_channel_id: channel.id,
      event_type: "test_delivery",
      dedupe_key: `test:${channel.id}:${scheduledAt}`,
      status: "sending",
      severity: "info",
      scheduled_for: scheduledAt,
    })
    .select("id, organization_id, event_type, status, severity, final_error, provider_response")
    .single();

  if (deliveryError) {
    throw mapPostgresError(deliveryError);
  }

  const startedAt = Date.now();

  try {
    const providerResponse = await sendSlackNotification({
      webhookUrl: config.webhookUrl,
      text: [
        "*Prod Pulse*",
        "Slack channel test delivery",
        `Organization: ${context.organization.name}`,
        "Status: test",
      ].join("\n"),
    });
    const attemptedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;

    const { error: attemptError } = await adminClient.from("alert_delivery_attempts").insert({
      organization_id: channel.organizationId,
      alert_delivery_id: String(deliveryData.id),
      attempt_number: 1,
      status: "sent",
      duration_ms: durationMs,
      provider_response: providerResponse.providerResponse,
    });

    if (attemptError) {
      throw mapPostgresError(attemptError);
    }

    const { error: updateError } = await adminClient
      .from("alert_deliveries")
      .update({
        status: "sent",
        sent_at: attemptedAt,
        provider_response: providerResponse.providerResponse,
      })
      .eq("id", String(deliveryData.id))
      .eq("organization_id", channel.organizationId);

    if (updateError) {
      throw mapPostgresError(updateError);
    }

    const { error: channelUpdateError } = await adminClient
      .from("notification_channels")
      .update({
        last_tested_at: attemptedAt,
        last_test_status: "sent",
      })
      .eq("id", channel.id)
      .eq("organization_id", channel.organizationId);

    if (channelUpdateError) {
      throw mapPostgresError(channelUpdateError);
    }

    await writeAuditLog({
      organizationId: channel.organizationId,
      actorType: "user",
      actorUserId: context.userId,
      actionType: "test",
      targetTable: "notification_channels",
      targetId: channel.id,
      metadata: {
        channel: sanitizeNotificationChannelForAudit(channel),
        deliveryId: String(deliveryData.id),
        status: "sent",
      },
      request: context.request,
    });

    return {
      channel: toSafeNotificationChannel({
        ...channel,
        lastTestedAt: attemptedAt,
        lastTestStatus: "sent",
      }),
      deliveryId: String(deliveryData.id),
      status: "sent" as const,
    };
  } catch (error) {
    const attemptedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    const safeError =
      error instanceof ApiError
        ? "The request could not be completed."
        : "The request could not be completed.";

    await adminClient.from("alert_delivery_attempts").insert({
      organization_id: channel.organizationId,
      alert_delivery_id: String(deliveryData.id),
      attempt_number: 1,
      status: "failed",
      duration_ms: durationMs,
      error_code: "slack_test_failed",
      error_message: safeError,
      provider_response: {},
    });

    await adminClient
      .from("alert_deliveries")
      .update({
        status: "failed",
        final_error: safeError,
        provider_response: {},
      })
      .eq("id", String(deliveryData.id))
      .eq("organization_id", channel.organizationId);

    await adminClient
      .from("notification_channels")
      .update({
        last_tested_at: attemptedAt,
        last_test_status: "failed",
      })
      .eq("id", channel.id)
      .eq("organization_id", channel.organizationId);

    await writeAuditLog({
      organizationId: channel.organizationId,
      actorType: "user",
      actorUserId: context.userId,
      actionType: "test",
      targetTable: "notification_channels",
      targetId: channel.id,
      metadata: {
        channel: sanitizeNotificationChannelForAudit(channel),
        deliveryId: String(deliveryData.id),
        status: "failed",
      },
      request: context.request,
    });

    throw new ApiError(400, "request_failed", "The request could not be completed.");
  }
}
