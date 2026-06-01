import { z } from "zod";

import { writeAuditLog } from "@/lib/server/audit/audit-log";
import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import {
  requireResourceAccess,
  type ActiveOrganizationContext,
} from "@/lib/server/auth/organization-context";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

const environmentStatusSchema = z.enum([
  "operational",
  "degraded",
  "down",
  "maintenance",
  "unknown",
]);

const environmentTypeSchema = z.enum([
  "production",
  "staging",
  "preview",
  "development",
  "other",
]);

export const createEnvironmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Slug must contain lowercase letters, numbers, and hyphens."),
  type: environmentTypeSchema,
  baseUrl: z.url().optional().nullable(),
  status: environmentStatusSchema.optional(),
});

export const updateEnvironmentSchema = createEnvironmentSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field must be provided.",
);

export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;
export type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;

export type EnvironmentSummary = {
  id: string;
  appId: string;
  name: string;
  slug: string;
  type: string;
  baseUrl: string | null;
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

function mapEnvironmentRow(row: Record<string, unknown>): EnvironmentSummary {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    name: String(row.name),
    slug: String(row.slug),
    type: String(row.type),
    baseUrl: (row.base_url as string | null) ?? null,
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listEnvironmentsForApp(
  organizationId: string,
  appId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<EnvironmentSummary[]> {
  const { data, error } = await adminClient
    .from("app_environments")
    .select("id, app_id, name, slug, type, base_url, status, created_at, updated_at")
    .eq("organization_id", organizationId)
    .eq("app_id", appId)
    .order("name", { ascending: true });

  if (error) {
    throw mapPostgresError(error);
  }

  return (data ?? []).map((row) => mapEnvironmentRow(row as Record<string, unknown>));
}

export async function getEnvironmentById(
  userId: string,
  environmentId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<EnvironmentSummary> {
  const { resource } = await requireResourceAccess(
    userId,
    "environment",
    environmentId,
    organizationId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("app_environments")
    .select("id, app_id, name, slug, type, base_url, status, created_at, updated_at")
    .eq("id", resource.id)
    .eq("organization_id", resource.organization_id)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(
      404,
      "APP_ENVIRONMENT_NOT_FOUND",
      "The requested environment was not found.",
    );
  }

  return mapEnvironmentRow(data as Record<string, unknown>);
}

async function assertAppAccess(
  userId: string,
  appId: string,
  organizationId: string,
  adminClient: AdminLike,
) {
  await requireResourceAccess(userId, "app", appId, organizationId, adminClient);
}

export async function createEnvironment(
  context: ServiceContext,
  appId: string,
  input: CreateEnvironmentInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<EnvironmentSummary> {
  await assertAppAccess(context.userId, appId, context.organization.id, adminClient);

  const { data, error } = await adminClient
    .from("app_environments")
    .insert({
      organization_id: context.organization.id,
      app_id: appId,
      name: input.name,
      slug: input.slug,
      type: input.type,
      base_url: input.baseUrl ?? null,
      status: input.status ?? "unknown",
      created_by: context.userId,
    })
    .select("id, app_id, name, slug, type, base_url, status, created_at, updated_at")
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const environment = mapEnvironmentRow(data as Record<string, unknown>);

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "app_environments",
    targetId: environment.id,
    metadata: {
      appId,
      name: environment.name,
      slug: environment.slug,
      type: environment.type,
    },
    request: context.request,
  });

  return environment;
}

export async function updateEnvironment(
  context: ServiceContext,
  environmentId: string,
  input: UpdateEnvironmentInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<EnvironmentSummary> {
  const existing = await getEnvironmentById(
    context.userId,
    environmentId,
    context.organization.id,
    adminClient,
  );

  const payload = {
    name: input.name ?? existing.name,
    slug: input.slug ?? existing.slug,
    type: input.type ?? existing.type,
    base_url: input.baseUrl === undefined ? existing.baseUrl : (input.baseUrl ?? null),
    status: input.status ?? existing.status,
  };

  const { data, error } = await adminClient
    .from("app_environments")
    .update(payload)
    .eq("id", environmentId)
    .eq("organization_id", context.organization.id)
    .select("id, app_id, name, slug, type, base_url, status, created_at, updated_at")
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const environment = mapEnvironmentRow(data as Record<string, unknown>);

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "app_environments",
    targetId: environment.id,
    metadata: {
      before: existing,
      after: environment,
    },
    request: context.request,
  });

  return environment;
}

export async function deleteEnvironment(
  context: ServiceContext,
  environmentId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const environment = await getEnvironmentById(
    context.userId,
    environmentId,
    context.organization.id,
    adminClient,
  );

  const { error } = await adminClient
    .from("app_environments")
    .delete()
    .eq("id", environmentId)
    .eq("organization_id", context.organization.id);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "delete",
    targetTable: "app_environments",
    targetId: environmentId,
    metadata: {
      deleted: environment,
    },
    request: context.request,
  });

  return { success: true };
}
