import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";
import {
  requireOrgMembership,
  type ActiveOrganizationContext,
} from "@/lib/server/auth/organization-context";
import type { SafeCiexIntegrationConfig } from "@/lib/integrations/ciex-config";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type CiexIntegrationServiceContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

type CiexIntegrationRow = {
  id: string;
  organization_id: string;
  kind: string;
  name: string;
  is_enabled: boolean;
  inbound_key_hash: string | null;
  inbound_key_hint: string | null;
  last_inbound_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CiexIntegrationSecretResult = {
  integration: SafeCiexIntegrationConfig;
  plaintextSecret: string;
};

const CIEX_KIND = "ciex";
const CIEX_NAME = "CIEX";
const CIEX_SELECT = [
  "id",
  "organization_id",
  "kind",
  "name",
  "is_enabled",
  "inbound_key_hash",
  "inbound_key_hint",
  "last_inbound_at",
  "created_at",
  "updated_at",
].join(", ");

function mapIntegrationRow(row: Record<string, unknown>): CiexIntegrationRow {
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    kind: String(row.kind),
    name: String(row.name),
    is_enabled: Boolean(row.is_enabled),
    inbound_key_hash: (row.inbound_key_hash as string | null) ?? null,
    inbound_key_hint: (row.inbound_key_hint as string | null) ?? null,
    last_inbound_at: (row.last_inbound_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function toIntegrationRecord(row: unknown): Record<string, unknown> {
  return row as unknown as Record<string, unknown>;
}

function toSafeCiexIntegrationConfig(row: CiexIntegrationRow): SafeCiexIntegrationConfig {
  return {
    id: row.id,
    kind: CIEX_KIND,
    name: row.name,
    isEnabled: row.is_enabled,
    inboundKeyHint: row.inbound_key_hint,
    lastInboundAt: row.last_inbound_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeIntegrationForAudit(row: CiexIntegrationRow | SafeCiexIntegrationConfig) {
  return {
    id: row.id,
    kind: CIEX_KIND,
    name: row.name,
    isEnabled: "is_enabled" in row ? row.is_enabled : row.isEnabled,
    inboundKeyHint: "inbound_key_hint" in row ? row.inbound_key_hint : row.inboundKeyHint,
    lastInboundAt: "last_inbound_at" in row ? row.last_inbound_at : row.lastInboundAt,
    updatedAt: "updated_at" in row ? row.updated_at : row.updatedAt,
  };
}

function requireManagerRole(context: CiexIntegrationServiceContext) {
  if (!canManageOperationalConfig(context.membership.role)) {
    throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
  }
}

function generateInboundSecret() {
  return randomBytes(32).toString("base64url");
}

function hashInboundSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function createInboundKeyHint(secret: string) {
  const tail = secret.slice(-6);
  return tail ? `****${tail}` : null;
}

async function getRawCiexIntegrationByOrganization(
  organizationId: string,
  adminClient: AdminLike,
) {
  const { data, error } = await adminClient
    .from("integrations")
    .select(CIEX_SELECT)
    .eq("organization_id", organizationId)
    .eq("kind", CIEX_KIND)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  return data ? mapIntegrationRow(toIntegrationRecord(data)) : null;
}

async function requireManagedOrganization(
  context: CiexIntegrationServiceContext,
  adminClient: AdminLike,
) {
  await requireOrgMembership(context.userId, context.organization.id, adminClient);
  requireManagerRole(context);
}

export async function getCiexIntegrationConfigForOrganization(
  userId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeCiexIntegrationConfig | null> {
  const organizationContext = await requireOrgMembership(userId, organizationId, adminClient);

  if (!canManageOperationalConfig(organizationContext.membership.role)) {
    throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
  }

  const integration = await getRawCiexIntegrationByOrganization(
    organizationContext.organization.id,
    adminClient,
  );

  return integration ? toSafeCiexIntegrationConfig(integration) : null;
}

export async function createCiexIntegration(
  context: CiexIntegrationServiceContext,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<CiexIntegrationSecretResult> {
  await requireManagedOrganization(context, adminClient);

  const existing = await getRawCiexIntegrationByOrganization(context.organization.id, adminClient);

  if (existing) {
    throw new ApiError(409, "RESOURCE_ALREADY_EXISTS", "A CIEX integration is already configured.");
  }

  const plaintextSecret = generateInboundSecret();
  const inboundKeyHash = hashInboundSecret(plaintextSecret);
  const inboundKeyHint = createInboundKeyHint(plaintextSecret);

  const { data, error } = await adminClient
    .from("integrations")
    .insert({
      organization_id: context.organization.id,
      kind: CIEX_KIND,
      name: CIEX_NAME,
      is_enabled: true,
      inbound_key_hash: inboundKeyHash,
      inbound_key_hint: inboundKeyHint,
      created_by: context.userId,
    })
    .select(CIEX_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const integration = mapIntegrationRow(toIntegrationRecord(data));

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "integrations",
    targetId: integration.id,
    metadata: {
      integration: sanitizeIntegrationForAudit(integration),
      action: "create_ciex_inbound",
    },
    request: context.request,
  });

  return {
    integration: toSafeCiexIntegrationConfig(integration),
    plaintextSecret,
  };
}

export async function enableCiexIntegration(
  context: CiexIntegrationServiceContext,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  await requireManagedOrganization(context, adminClient);

  const before = await getRawCiexIntegrationByOrganization(context.organization.id, adminClient);

  if (!before) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  const { data, error } = await adminClient
    .from("integrations")
    .update({ is_enabled: true })
    .eq("id", before.id)
    .eq("organization_id", context.organization.id)
    .select(CIEX_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const after = mapIntegrationRow(toIntegrationRecord(data));

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "integrations",
    targetId: before.id,
    metadata: {
      before: sanitizeIntegrationForAudit(before),
      after: sanitizeIntegrationForAudit(after),
      action: "enable_ciex_inbound",
    },
    request: context.request,
  });

  return toSafeCiexIntegrationConfig(after);
}

export async function disableCiexIntegration(
  context: CiexIntegrationServiceContext,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  await requireManagedOrganization(context, adminClient);

  const before = await getRawCiexIntegrationByOrganization(context.organization.id, adminClient);

  if (!before) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  const { data, error } = await adminClient
    .from("integrations")
    .update({ is_enabled: false })
    .eq("id", before.id)
    .eq("organization_id", context.organization.id)
    .select(CIEX_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const after = mapIntegrationRow(toIntegrationRecord(data));

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "integrations",
    targetId: before.id,
    metadata: {
      before: sanitizeIntegrationForAudit(before),
      after: sanitizeIntegrationForAudit(after),
      action: "disable_ciex_inbound",
    },
    request: context.request,
  });

  return toSafeCiexIntegrationConfig(after);
}

export async function rotateCiexIntegrationKey(
  context: CiexIntegrationServiceContext,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<CiexIntegrationSecretResult> {
  await requireManagedOrganization(context, adminClient);

  const before = await getRawCiexIntegrationByOrganization(context.organization.id, adminClient);

  if (!before) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  const plaintextSecret = generateInboundSecret();
  const inboundKeyHash = hashInboundSecret(plaintextSecret);
  const inboundKeyHint = createInboundKeyHint(plaintextSecret);

  const { data, error } = await adminClient
    .from("integrations")
    .update({
      inbound_key_hash: inboundKeyHash,
      inbound_key_hint: inboundKeyHint,
    })
    .eq("id", before.id)
    .eq("organization_id", context.organization.id)
    .select(CIEX_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const after = mapIntegrationRow(toIntegrationRecord(data));

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "rotate_secret",
    targetTable: "integrations",
    targetId: before.id,
    metadata: {
      before: sanitizeIntegrationForAudit(before),
      after: sanitizeIntegrationForAudit(after),
      action: "rotate_ciex_inbound_key",
    },
    request: context.request,
  });

  return {
    integration: toSafeCiexIntegrationConfig(after),
    plaintextSecret,
  };
}
