import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";

import {
  ORG_ROLES,
  type OrgRole,
  hasRoleAtLeast,
} from "@/lib/server/auth/permissions";
import { ApiError } from "@/lib/server/api/errors";

export type OrganizationRecord = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
};

export type MembershipRecord = {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  disabled_at: string | null;
  created_at: string;
  organizations: OrganizationRecord | OrganizationRecord[] | null;
};

export type OrganizationMembership = {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
};

export type ActiveOrganizationContext = {
  organization: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
  };
  membership: OrganizationMembership;
};

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type ResourceKind =
  | "app"
  | "environment"
  | "monitor"
  | "heartbeat"
  | "incident"
  | "status_page"
  | "status_page_component"
  | "alert_rule"
  | "notification_channel";

const RESOURCE_TABLES: Record<ResourceKind, string> = {
  app: "monitored_apps",
  environment: "app_environments",
  monitor: "monitors",
  heartbeat: "heartbeats",
  incident: "incidents",
  status_page: "status_pages",
  status_page_component: "status_page_components",
  alert_rule: "alert_rules",
  notification_channel: "notification_channels",
};

const RESOURCE_SELECTS: Record<ResourceKind, string> = {
  app: "id, organization_id, app_id, environment_id, name, slug",
  environment: "id, organization_id, app_id, environment_id, name, slug",
  monitor: "id, organization_id, app_id, environment_id, name, slug",
  heartbeat: "id, organization_id, app_id, environment_id, monitor_id, name, slug",
  incident: "id, organization_id, app_id, environment_id, monitor_id",
  status_page: "id, organization_id, name, slug",
  status_page_component:
    "id, organization_id, status_page_id, monitored_app_id, environment_id, monitor_id, display_name",
  alert_rule: "id, organization_id, app_id, monitor_id, name",
  notification_channel: "id, organization_id, name, type",
};

function normalizeMembership(row: MembershipRecord): ActiveOrganizationContext | null {
  const organization = Array.isArray(row.organizations)
    ? row.organizations[0]
    : row.organizations;

  if (!organization) {
    return null;
  }

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      isActive: organization.is_active,
    },
    membership: {
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.role,
      createdAt: row.created_at,
    },
  };
}

export async function getMembershipForOrg(
  userId: string,
  organizationId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<ActiveOrganizationContext | null> {
  const { data, error } = await adminClient
    .from("memberships")
    .select(
      "id, organization_id, user_id, role, disabled_at, created_at, organizations(id, name, slug, is_active)",
    )
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .is("disabled_at", null)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "ORG_MEMBERSHIP_LOOKUP_FAILED", error.message);
  }

  return data ? normalizeMembership(data as MembershipRecord) : null;
}

export async function getActiveOrganizationForUser(
  userId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<ActiveOrganizationContext | null> {
  const { data, error } = await adminClient
    .from("memberships")
    .select(
      "id, organization_id, user_id, role, disabled_at, created_at, organizations(id, name, slug, is_active)",
    )
    .eq("user_id", userId)
    .is("disabled_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiError(500, "ACTIVE_ORG_LOOKUP_FAILED", error.message);
  }

  if (!data || data.length === 0) {
    return null;
  }

  // TODO: Replace first-membership fallback with an explicit organization switcher.
  return normalizeMembership(data[0] as MembershipRecord);
}

export async function requireOrgMembership(
  userId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<ActiveOrganizationContext> {
  const context = organizationId
    ? await getMembershipForOrg(userId, organizationId, adminClient)
    : await getActiveOrganizationForUser(userId, adminClient);

  if (!context) {
    throw new ApiError(
      403,
      "ORG_MEMBERSHIP_REQUIRED",
      "The current user does not have access to an active organization.",
    );
  }

  return context;
}

export async function requireOrgRole(
  userId: string,
  allowedRoles: OrgRole[],
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<ActiveOrganizationContext> {
  const context = await requireOrgMembership(userId, organizationId, adminClient);

  if (!allowedRoles.includes(context.membership.role)) {
    throw new ApiError(
      403,
      "ORG_ROLE_REQUIRED",
      `This action requires one of: ${allowedRoles.join(", ")}.`,
    );
  }

  return context;
}

export async function requireResourceAccess(
  userId: string,
  resourceKind: ResourceKind,
  resourceId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const context = await requireOrgMembership(userId, organizationId, adminClient);
  const table = RESOURCE_TABLES[resourceKind];

  const { data, error } = await adminClient
    .from(table)
    .select(RESOURCE_SELECTS[resourceKind])
    .eq("id", resourceId)
    .eq("organization_id", context.organization.id)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "RESOURCE_LOOKUP_FAILED", error.message);
  }

  if (!data) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  return {
    organizationContext: context,
    resource: data as unknown as {
      id: string;
      organization_id: string;
      app_id?: string | null;
      environment_id?: string | null;
      monitor_id?: string | null;
      status_page_id?: string | null;
      monitored_app_id?: string | null;
      name?: string | null;
      slug?: string | null;
    },
  };
}

export function canAssumeRole(
  currentRole: OrgRole,
  requiredRole: OrgRole,
): boolean {
  return hasRoleAtLeast(currentRole, requiredRole);
}

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}
