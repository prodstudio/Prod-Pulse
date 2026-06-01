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
  evaluateHeartbeatFreshness,
} from "@/lib/server/heartbeats/heartbeat-evaluator";
import {
  buildHeartbeatTokenHint,
  generateHeartbeatToken,
  hashHeartbeatToken,
  verifyHeartbeatToken,
} from "@/lib/server/heartbeats/heartbeat-token";
import {
  sanitizeHeartbeatForAudit,
  sanitizeHeartbeatPayload,
  toSafeHeartbeatDetail,
  toSafeHeartbeatSummary,
  type HeartbeatPingPayload,
  type RawHeartbeatRecord,
  type SafeHeartbeatSummary,
} from "@/lib/server/heartbeats/heartbeat-sanitization";
import type { RawMonitorRecord } from "@/lib/server/monitors/monitor-sanitization";
import {
  getRawMonitorByIdForOrganization,
  getRawMonitorForExecution,
} from "@/lib/server/monitors/monitor-service";
import { persistHeartbeatMonitorExecutionResult } from "@/lib/server/monitoring/result-service";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type HeartbeatServiceContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

type HeartbeatCreateResult = {
  heartbeat: SafeHeartbeatSummary;
  rawToken: string;
};

type HeartbeatRotateResult = HeartbeatCreateResult;

type HeartbeatIngestResult = {
  ok: true;
  acceptedAt: string;
  status: "ok" | "degraded" | "down";
};

export const createHeartbeatSchema = z.object({
  appId: z.uuid(),
  environmentId: z.uuid().optional().nullable(),
  monitorId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Slug must contain lowercase letters, numbers, and hyphens."),
  expectedIntervalSeconds: z.int().min(30).max(86_400),
  graceSeconds: z.int().min(0).max(86_400).optional().default(300),
  isEnabled: z.boolean().optional().default(true),
});

export const updateHeartbeatSchema = z
  .object({
    appId: z.uuid().optional(),
    environmentId: z.uuid().optional().nullable(),
    monitorId: z.uuid().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9-]+$/, "Slug must contain lowercase letters, numbers, and hyphens.")
      .optional(),
    expectedIntervalSeconds: z.int().min(30).max(86_400).optional(),
    graceSeconds: z.int().min(0).max(86_400).optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

export const heartbeatPingSchema = z.object({
  service: z.string().trim().max(100).optional(),
  environment: z.string().trim().max(100).optional(),
  jobName: z.string().trim().max(140).optional(),
  runId: z.string().trim().max(160).optional(),
  status: z.enum(["ok", "degraded", "down"]).optional(),
  message: z.string().trim().max(4000).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  timestamp: z.iso.datetime().optional(),
});

const HEARTBEAT_SELECT = [
  "id",
  "organization_id",
  "app_id",
  "environment_id",
  "monitor_id",
  "name",
  "slug",
  "expected_interval_seconds",
  "grace_seconds",
  "token_hash",
  "token_hint",
  "is_enabled",
  "status",
  "last_seen_at",
  "last_payload",
  "created_at",
  "updated_at",
].join(", ");

const MAX_INGEST_BODY_BYTES = 4 * 1024;

function mapHeartbeatRow(row: Record<string, unknown>): RawHeartbeatRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    appId: String(row.app_id),
    environmentId: (row.environment_id as string | null) ?? null,
    monitorId: (row.monitor_id as string | null) ?? null,
    name: String(row.name),
    slug: String(row.slug),
    expectedIntervalSeconds: Number(row.expected_interval_seconds),
    graceSeconds: Number(row.grace_seconds),
    tokenHash: String(row.token_hash),
    tokenHint: (row.token_hint as string | null) ?? null,
    isEnabled: Boolean(row.is_enabled),
    status: String(row.status),
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
    lastPayload: ((row.last_payload as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapHeartbeatPayloadStatusToMonitorStatus(status: "ok" | "degraded" | "down") {
  switch (status) {
    case "degraded":
      return "degraded";
    case "down":
      return "down";
    default:
      return "operational";
  }
}

function buildHeartbeatMonitorConfiguration(
  heartbeat: Pick<RawHeartbeatRecord, "id" | "expectedIntervalSeconds" | "graceSeconds">,
  existing: Record<string, unknown>,
) {
  return {
    ...existing,
    heartbeatId: heartbeat.id,
    expectedIntervalSeconds: heartbeat.expectedIntervalSeconds,
    graceSeconds: heartbeat.graceSeconds,
    freshnessThresholdSeconds:
      heartbeat.expectedIntervalSeconds + heartbeat.graceSeconds,
  };
}

async function assertAppAndEnvironmentAccess(
  userId: string,
  organizationId: string,
  appId: string,
  environmentId: string | null | undefined,
  adminClient: AdminLike,
) {
  await requireResourceAccess(userId, "app", appId, organizationId, adminClient);

  if (!environmentId) {
    return;
  }

  const { resource } = await requireResourceAccess(
    userId,
    "environment",
    environmentId,
    organizationId,
    adminClient,
  );

  if (resource.app_id !== appId) {
    throw new ApiError(
      400,
      "INVALID_RELATION",
      "The selected related record is invalid.",
    );
  }
}

async function getRawHeartbeatById(
  userId: string,
  heartbeatId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { resource } = await requireResourceAccess(
    userId,
    "heartbeat",
    heartbeatId,
    organizationId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("heartbeats")
    .select(HEARTBEAT_SELECT)
    .eq("id", resource.id)
    .eq("organization_id", resource.organization_id)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  return mapHeartbeatRow(data as unknown as Record<string, unknown>);
}

async function getRawHeartbeatByToken(
  token: string,
  adminClient: AdminLike,
) {
  const tokenHash = hashHeartbeatToken(token);
  const { data, error } = await adminClient
    .from("heartbeats")
    .select(HEARTBEAT_SELECT)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    return null;
  }

  const heartbeat = mapHeartbeatRow(data as unknown as Record<string, unknown>);

  if (!verifyHeartbeatToken(token, heartbeat.tokenHash)) {
    return null;
  }

  return heartbeat;
}

async function assertHeartbeatMonitorAccess(
  userId: string,
  organizationId: string,
  input: {
    appId: string;
    environmentId: string | null | undefined;
    monitorId: string;
  },
  adminClient: AdminLike,
  currentHeartbeatId?: string,
): Promise<RawMonitorRecord> {
  const monitor = await getRawMonitorForExecution(
    userId,
    input.monitorId,
    organizationId,
    adminClient,
  );

  if (monitor.type !== "heartbeat") {
    throw new ApiError(
      400,
      "INVALID_RELATION",
      "The selected related record is invalid.",
    );
  }

  if (monitor.appId !== input.appId) {
    throw new ApiError(
      400,
      "INVALID_RELATION",
      "The selected related record is invalid.",
    );
  }

  if ((monitor.environmentId ?? null) !== (input.environmentId ?? null)) {
    throw new ApiError(
      400,
      "INVALID_RELATION",
      "The selected related record is invalid.",
    );
  }

  const { data, error } = await adminClient
    .from("heartbeats")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("monitor_id", monitor.id)
    .limit(1);

  if (error) {
    throw mapPostgresError(error);
  }

  const conflictingHeartbeatId = (data?.[0] as { id?: string } | undefined)?.id;

  if (conflictingHeartbeatId && conflictingHeartbeatId !== currentHeartbeatId) {
    throw new ApiError(
      409,
      "conflict",
      "A record with these details already exists.",
    );
  }

  return monitor;
}

async function syncLinkedMonitor(
  heartbeat: RawHeartbeatRecord,
  adminClient: AdminLike,
) {
  if (!heartbeat.monitorId) {
    return;
  }

  const { data: monitorRow, error: monitorError } = await adminClient
    .from("monitors")
    .select("configuration")
    .eq("id", heartbeat.monitorId)
    .eq("organization_id", heartbeat.organizationId)
    .maybeSingle();

  if (monitorError) {
    throw mapPostgresError(monitorError);
  }

  const nextConfiguration = buildHeartbeatMonitorConfiguration(
    heartbeat,
    ((monitorRow?.configuration as unknown as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >,
  );

  const { error } = await adminClient
    .from("monitors")
    .update({
      app_id: heartbeat.appId,
      environment_id: heartbeat.environmentId,
      interval_seconds: heartbeat.expectedIntervalSeconds,
      configuration: nextConfiguration,
    })
    .eq("id", heartbeat.monitorId)
    .eq("organization_id", heartbeat.organizationId);

  if (error) {
    throw mapPostgresError(error);
  }
}

async function updateHeartbeatIngestionState(
  heartbeat: RawHeartbeatRecord,
  acceptedAt: string,
  payload: ReturnType<typeof sanitizeHeartbeatPayload>,
  adminClient: AdminLike,
) {
  const status = mapHeartbeatPayloadStatusToMonitorStatus(payload.status);

  const { data, error } = await adminClient
    .from("heartbeats")
    .update({
      last_seen_at: acceptedAt,
      last_payload: payload,
      status,
    })
    .eq("id", heartbeat.id)
    .eq("organization_id", heartbeat.organizationId)
    .select(HEARTBEAT_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  return mapHeartbeatRow(data as unknown as Record<string, unknown>);
}

async function readHeartbeatPingPayload(request: Request): Promise<HeartbeatPingPayload> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(contentLength) && contentLength > MAX_INGEST_BODY_BYTES) {
    throw new ApiError(400, "request_failed", "The request could not be completed.");
  }

  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_INGEST_BODY_BYTES) {
    throw new ApiError(400, "request_failed", "The request could not be completed.");
  }

  if (!rawBody.trim()) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, "request_failed", "The request could not be completed.");
  }

  const validation = heartbeatPingSchema.safeParse(parsed);

  if (!validation.success) {
    throw new ApiError(400, "request_failed", "The request could not be completed.");
  }

  return validation.data;
}

export async function listHeartbeatsForOrganization(
  userId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeHeartbeatSummary[]> {
  const organizationContext = await requireOrgMembership(userId, organizationId, adminClient);

  const { data, error } = await adminClient
    .from("heartbeats")
    .select(HEARTBEAT_SELECT)
    .eq("organization_id", organizationContext.organization.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw mapPostgresError(error);
  }

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) =>
    toSafeHeartbeatSummary(mapHeartbeatRow(row)),
  );
}

export async function getHeartbeatById(
  userId: string,
  heartbeatId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  return toSafeHeartbeatDetail(
    await getRawHeartbeatById(userId, heartbeatId, organizationId, adminClient),
  );
}

export async function getHeartbeatByMonitorId(
  organizationId: string,
  monitorId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { data, error } = await adminClient
    .from("heartbeats")
    .select(HEARTBEAT_SELECT)
    .eq("organization_id", organizationId)
    .eq("monitor_id", monitorId)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  return data
    ? toSafeHeartbeatDetail(mapHeartbeatRow(data as unknown as Record<string, unknown>))
    : null;
}

export async function getRawHeartbeatByMonitorId(
  organizationId: string,
  monitorId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { data, error } = await adminClient
    .from("heartbeats")
    .select(HEARTBEAT_SELECT)
    .eq("organization_id", organizationId)
    .eq("monitor_id", monitorId)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  return data ? mapHeartbeatRow(data as unknown as Record<string, unknown>) : null;
}

export async function createHeartbeat(
  context: HeartbeatServiceContext,
  input: z.infer<typeof createHeartbeatSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<HeartbeatCreateResult> {
  await assertAppAndEnvironmentAccess(
    context.userId,
    context.organization.id,
    input.appId,
    input.environmentId,
    adminClient,
  );
  await assertHeartbeatMonitorAccess(
    context.userId,
    context.organization.id,
    {
      appId: input.appId,
      environmentId: input.environmentId ?? null,
      monitorId: input.monitorId,
    },
    adminClient,
  );

  const generatedToken = generateHeartbeatToken();
  const { data, error } = await adminClient
    .from("heartbeats")
    .insert({
      organization_id: context.organization.id,
      app_id: input.appId,
      environment_id: input.environmentId ?? null,
      monitor_id: input.monitorId,
      name: input.name,
      slug: input.slug,
      expected_interval_seconds: input.expectedIntervalSeconds,
      grace_seconds: input.graceSeconds,
      token_hash: generatedToken.tokenHash,
      token_hint: generatedToken.tokenHint,
      is_enabled: input.isEnabled,
      status: "unknown",
      created_by: context.userId,
    })
    .select(HEARTBEAT_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const heartbeat = mapHeartbeatRow(data as unknown as Record<string, unknown>);
  await syncLinkedMonitor(heartbeat, adminClient);

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "heartbeats",
    targetId: heartbeat.id,
    metadata: {
      heartbeat: sanitizeHeartbeatForAudit(heartbeat),
    },
    request: context.request,
  });

  return {
    heartbeat: toSafeHeartbeatSummary(heartbeat),
    rawToken: generatedToken.rawToken,
  };
}

export async function updateHeartbeat(
  context: HeartbeatServiceContext,
  heartbeatId: string,
  input: z.infer<typeof updateHeartbeatSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const before = await getRawHeartbeatById(
    context.userId,
    heartbeatId,
    context.organization.id,
    adminClient,
  );

  const nextAppId = input.appId ?? before.appId;
  const nextEnvironmentId =
    input.environmentId === undefined ? before.environmentId : (input.environmentId ?? null);
  const nextMonitorId = input.monitorId ?? before.monitorId;

  if (!nextMonitorId) {
    throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
  }

  await assertAppAndEnvironmentAccess(
    context.userId,
    context.organization.id,
    nextAppId,
    nextEnvironmentId,
    adminClient,
  );
  await assertHeartbeatMonitorAccess(
    context.userId,
    context.organization.id,
    {
      appId: nextAppId,
      environmentId: nextEnvironmentId,
      monitorId: nextMonitorId,
    },
    adminClient,
    before.id,
  );

  const { data, error } = await adminClient
    .from("heartbeats")
    .update({
      app_id: nextAppId,
      environment_id: nextEnvironmentId,
      monitor_id: nextMonitorId,
      name: input.name ?? before.name,
      slug: input.slug ?? before.slug,
      expected_interval_seconds:
        input.expectedIntervalSeconds ?? before.expectedIntervalSeconds,
      grace_seconds: input.graceSeconds ?? before.graceSeconds,
      is_enabled: input.isEnabled ?? before.isEnabled,
    })
    .eq("id", before.id)
    .eq("organization_id", before.organizationId)
    .select(HEARTBEAT_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const after = mapHeartbeatRow(data as unknown as Record<string, unknown>);
  await syncLinkedMonitor(after, adminClient);

  await writeAuditLog({
    organizationId: after.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "heartbeats",
    targetId: after.id,
    metadata: {
      before: sanitizeHeartbeatForAudit(before),
      after: sanitizeHeartbeatForAudit(after),
    },
    request: context.request,
  });

  return toSafeHeartbeatSummary(after);
}

export async function deleteHeartbeat(
  context: HeartbeatServiceContext,
  heartbeatId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const heartbeat = await getRawHeartbeatById(
    context.userId,
    heartbeatId,
    context.organization.id,
    adminClient,
  );

  const { error } = await adminClient
    .from("heartbeats")
    .delete()
    .eq("id", heartbeat.id)
    .eq("organization_id", heartbeat.organizationId);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: heartbeat.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "delete",
    targetTable: "heartbeats",
    targetId: heartbeat.id,
    metadata: {
      deleted: sanitizeHeartbeatForAudit(heartbeat),
    },
    request: context.request,
  });

  return {
    id: heartbeat.id,
    deleted: true,
  };
}

export async function rotateHeartbeatToken(
  context: HeartbeatServiceContext,
  heartbeatId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<HeartbeatRotateResult> {
  const before = await getRawHeartbeatById(
    context.userId,
    heartbeatId,
    context.organization.id,
    adminClient,
  );
  const generatedToken = generateHeartbeatToken();

  const { data, error } = await adminClient
    .from("heartbeats")
    .update({
      token_hash: generatedToken.tokenHash,
      token_hint: buildHeartbeatTokenHint(generatedToken.rawToken),
    })
    .eq("id", before.id)
    .eq("organization_id", before.organizationId)
    .select(HEARTBEAT_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const after = mapHeartbeatRow(data as unknown as Record<string, unknown>);

  await writeAuditLog({
    organizationId: after.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "rotate_secret",
    targetTable: "heartbeats",
    targetId: after.id,
    metadata: {
      before: sanitizeHeartbeatForAudit(before),
      after: sanitizeHeartbeatForAudit(after),
    },
    request: context.request,
  });

  return {
    heartbeat: toSafeHeartbeatSummary(after),
    rawToken: generatedToken.rawToken,
  };
}

export async function ingestHeartbeatPing(
  token: string,
  request: Request,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<HeartbeatIngestResult> {
  const trimmedToken = token.trim();

  if (!trimmedToken) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  const heartbeat = await getRawHeartbeatByToken(trimmedToken, adminClient);

  if (!heartbeat || !heartbeat.isEnabled) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  const payload = sanitizeHeartbeatPayload(await readHeartbeatPingPayload(request));
  const acceptedAt = new Date().toISOString();
  const updatedHeartbeat = await updateHeartbeatIngestionState(
    heartbeat,
    acceptedAt,
    payload,
    adminClient,
  );

  if (updatedHeartbeat.monitorId) {
    const monitor = await getRawMonitorByIdForOrganization(
      updatedHeartbeat.monitorId,
      updatedHeartbeat.organizationId,
      adminClient,
    );

    if (monitor) {
      const execution = evaluateHeartbeatFreshness({
        monitor,
        heartbeat: updatedHeartbeat,
        now: new Date(acceptedAt),
      });

      await persistHeartbeatMonitorExecutionResult(
        {
          actorUserId: "heartbeat",
          monitor,
          execution,
        },
        {
          idempotencyKey: payload.runId
            ? `heartbeat:${updatedHeartbeat.id}:${payload.runId}`
            : null,
        },
        adminClient,
      );
    }
  }

  return {
    ok: true,
    acceptedAt,
    status: payload.status,
  };
}
