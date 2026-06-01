import "server-only";

import { timingSafeEqual } from "node:crypto";

import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

export const INITIAL_OWNER_BOOTSTRAP_TOKEN_ENV = "INITIAL_OWNER_BOOTSTRAP_TOKEN";

export type AuthIdentity = {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

export type BootstrapAvailability =
  | "available"
  | "token_not_configured"
  | "memberships_exist";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

function getBootstrapToken() {
  return process.env[INITIAL_OWNER_BOOTSTRAP_TOKEN_ENV]?.trim() ?? "";
}

function hasConfiguredBootstrapToken() {
  return getBootstrapToken().length > 0;
}

function compareBootstrapToken(candidate: string) {
  const expected = getBootstrapToken();

  if (!expected || !candidate) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const candidateBuffer = Buffer.from(candidate, "utf8");

  if (expectedBuffer.length !== candidateBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, candidateBuffer);
}

function sanitizeProfileValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function syncProfileFromAuthIdentity(
  user: AuthIdentity,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const payload = {
    id: user.id,
    email: sanitizeProfileValue(user.email),
    full_name: sanitizeProfileValue(user.fullName),
    avatar_url: sanitizeProfileValue(user.avatarUrl),
  };

  const { error } = await adminClient
    .from("profiles")
    .upsert(payload, { onConflict: "id" });

  if (error) {
    throw mapPostgresError(error);
  }
}

export async function hasAnyActiveMemberships(
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { data, error } = await adminClient
    .from("memberships")
    .select("id")
    .is("disabled_at", null)
    .limit(1);

  if (error) {
    throw mapPostgresError(error);
  }

  return (data ?? []).length > 0;
}

export async function getBootstrapAvailability(
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<BootstrapAvailability> {
  if (await hasAnyActiveMemberships(adminClient)) {
    return "memberships_exist";
  }

  if (!hasConfiguredBootstrapToken()) {
    return "token_not_configured";
  }

  return "available";
}

export async function bootstrapInitialOwner(input: {
  user: AuthIdentity;
  organizationName: string;
  organizationSlug: string;
  fullName?: string | null;
  bootstrapToken: string;
  request?: Request;
  adminClient?: AdminLike;
}) {
  const adminClient = input.adminClient ?? createSupabaseAdminClient();
  const availability = await getBootstrapAvailability(adminClient);

  if (availability === "memberships_exist") {
    throw new ApiError(403, "forbidden", "You do not have permission to perform this action.");
  }

  if (availability === "token_not_configured" || !compareBootstrapToken(input.bootstrapToken)) {
    throw new ApiError(403, "forbidden", "You do not have permission to perform this action.");
  }

  const organizationSlug = normalizeSlug(input.organizationSlug || input.organizationName);

  if (!organizationSlug) {
    throw new ApiError(400, "validation_failed", "Request validation failed.", {
      fieldErrors: {
        organizationSlug: ["Organization slug is required."],
      },
    });
  }

  const { data, error } = await adminClient.rpc("bootstrap_initial_owner", {
    target_user_id: input.user.id,
    target_email: sanitizeProfileValue(input.user.email),
    target_full_name: sanitizeProfileValue(input.fullName) ?? sanitizeProfileValue(input.user.fullName),
    target_avatar_url: sanitizeProfileValue(input.user.avatarUrl),
    organization_name: input.organizationName.trim(),
    organization_slug: organizationSlug,
  });

  if (error) {
    throw mapPostgresError(error);
  }

  const result = Array.isArray(data) ? data[0] : data;
  const organizationId = result?.organization_id as string | undefined;

  if (!organizationId) {
    throw new ApiError(500, "request_failed", "The request could not be completed.");
  }

  await writeAuditLog({
    organizationId,
    actorType: "user",
    actorUserId: input.user.id,
    actionType: "create",
    targetTable: "organizations",
    targetId: organizationId,
    metadata: {
      bootstrap: true,
      organization: {
        id: organizationId,
        name: input.organizationName.trim(),
        slug: organizationSlug,
      },
      membership: {
        role: "owner",
      },
    },
    request: input.request,
  });

  return {
    organizationId,
  };
}
