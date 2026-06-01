import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit/audit-log";
import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import {
  requireResourceAccess,
  type ActiveOrganizationContext,
} from "@/lib/server/auth/organization-context";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

const appStatusSchema = z.enum([
  "operational",
  "degraded",
  "down",
  "maintenance",
  "unknown",
]);

export const createAppSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Slug must contain lowercase letters, numbers, and hyphens."),
  description: z.string().trim().max(1000).optional().nullable(),
  ownerTeam: z.string().trim().max(120).optional().nullable(),
  status: appStatusSchema.optional(),
});

export const updateAppSchema = createAppSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field must be provided.",
);

export type CreateAppInput = z.infer<typeof createAppSchema>;
export type UpdateAppInput = z.infer<typeof updateAppSchema>;

export type AppSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  ownerTeam: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ServiceContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

function mapAppRow(row: Record<string, unknown>): AppSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: (row.description as string | null) ?? null,
    ownerTeam: (row.owner_team as string | null) ?? null,
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listAppsForOrganization(
  organizationId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<AppSummary[]> {
  const { data, error } = await adminClient
    .from("monitored_apps")
    .select("id, name, slug, description, owner_team, status, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) {
    throw mapPostgresError(error);
  }

  return (data ?? []).map((row) => mapAppRow(row as Record<string, unknown>));
}

export async function getAppById(
  userId: string,
  appId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<AppSummary> {
  const { resource } = await requireResourceAccess(
    userId,
    "app",
    appId,
    organizationId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("monitored_apps")
    .select("id, name, slug, description, owner_team, status, created_at, updated_at")
    .eq("id", resource.id)
    .eq("organization_id", resource.organization_id)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "APP_NOT_FOUND", "The requested app was not found.");
  }

  return mapAppRow(data as Record<string, unknown>);
}

export async function createApp(
  context: ServiceContext,
  input: CreateAppInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<AppSummary> {
  const { data, error } = await adminClient
    .from("monitored_apps")
    .insert({
      organization_id: context.organization.id,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      owner_team: input.ownerTeam ?? null,
      status: input.status ?? "unknown",
      created_by: context.userId,
    })
    .select("id, name, slug, description, owner_team, status, created_at, updated_at")
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const app = mapAppRow(data as Record<string, unknown>);

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "monitored_apps",
    targetId: app.id,
    metadata: {
      name: app.name,
      slug: app.slug,
      status: app.status,
    },
    request: context.request,
  });

  return app;
}

export async function updateApp(
  context: ServiceContext,
  appId: string,
  input: UpdateAppInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<AppSummary> {
  const existing = await getAppById(
    context.userId,
    appId,
    context.organization.id,
    adminClient,
  );

  const payload = {
    name: input.name ?? existing.name,
    slug: input.slug ?? existing.slug,
    description:
      input.description === undefined ? existing.description : (input.description ?? null),
    owner_team: input.ownerTeam === undefined ? existing.ownerTeam : (input.ownerTeam ?? null),
    status: input.status ?? existing.status,
  };

  const { data, error } = await adminClient
    .from("monitored_apps")
    .update(payload)
    .eq("id", appId)
    .eq("organization_id", context.organization.id)
    .select("id, name, slug, description, owner_team, status, created_at, updated_at")
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const app = mapAppRow(data as Record<string, unknown>);

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "monitored_apps",
    targetId: app.id,
    metadata: {
      before: existing,
      after: app,
    },
    request: context.request,
  });

  return app;
}

export async function deleteApp(
  context: ServiceContext,
  appId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const app = await getAppById(context.userId, appId, context.organization.id, adminClient);

  const { error } = await adminClient
    .from("monitored_apps")
    .delete()
    .eq("id", appId)
    .eq("organization_id", context.organization.id);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "delete",
    targetTable: "monitored_apps",
    targetId: appId,
    metadata: {
      deleted: app,
    },
    request: context.request,
  });

  return { success: true };
}
