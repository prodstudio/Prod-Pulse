import "server-only";

import { z } from "zod";

import { getAppById, listAppsForOrganization } from "@/lib/server/apps/app-service";
import {
  getEnvironmentById,
  listEnvironmentsForApp,
} from "@/lib/server/apps/environment-service";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import {
  requireOrgMembership,
  requireResourceAccess,
  type ActiveOrganizationContext,
} from "@/lib/server/auth/organization-context";
import {
  getHeartbeatByMonitorId,
} from "@/lib/server/heartbeats/heartbeat-service";
import { listIncidentsForOrganization } from "@/lib/server/incidents/incident-service";
import {
  getMonitorById,
  listMonitorsForOrganization,
} from "@/lib/server/monitors/monitor-service";
import { listMonitorResultsForMonitor } from "@/lib/server/monitoring/result-service";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";
import {
  buildStatusPagePreviewComponent,
  deriveOverallStatus,
  derivePreviewTimestamps,
  uniqueIncidentEvidence,
} from "@/lib/server/status-pages/status-aggregation";
import {
  sanitizeStatusPageComponentForAudit,
  sanitizeStatusPageForAudit,
  toSafeStatusPageComponentSummary,
  toSafeStatusPageSummary,
  type RawStatusPageComponentRecord,
  type RawStatusPageRecord,
  type SafeStatusPagePreview,
  type SafeStatusPageSummary,
} from "@/lib/server/status-pages/status-page-sanitization";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type StatusPageServiceContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

const statusPageSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9-]+$/, "Slug must contain lowercase letters, numbers, and hyphens.");

export const createStatusPageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: statusPageSlugSchema,
  description: z.string().trim().max(1000).optional().nullable(),
  isPublic: z.boolean().optional().default(false),
});

export const updateStatusPageSchema = createStatusPageSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

const statusPageComponentBaseSchema = z.object({
  monitoredAppId: z.uuid().optional().nullable(),
  environmentId: z.uuid().optional().nullable(),
  monitorId: z.uuid().optional().nullable(),
  displayName: z.string().trim().min(1).max(160),
  sortOrder: z.int().min(0).max(10_000).optional().default(0),
  isVisible: z.boolean().optional().default(true),
});

export const createStatusPageComponentSchema = statusPageComponentBaseSchema
  .refine(
    (value) => Boolean(value.monitoredAppId || value.environmentId || value.monitorId),
    "At least one component mapping target must be provided.",
  );

export const updateStatusPageComponentSchema = statusPageComponentBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

const STATUS_PAGE_SELECT = [
  "id",
  "organization_id",
  "name",
  "slug",
  "description",
  "is_public",
  "created_at",
  "updated_at",
].join(", ");

const STATUS_PAGE_COMPONENT_SELECT = [
  "id",
  "organization_id",
  "status_page_id",
  "monitored_app_id",
  "environment_id",
  "monitor_id",
  "display_name",
  "sort_order",
  "is_visible",
  "created_at",
  "updated_at",
].join(", ");

function mapStatusPageRow(row: Record<string, unknown>): RawStatusPageRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    slug: String(row.slug),
    description: (row.description as string | null) ?? null,
    isPublic: Boolean(row.is_public),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapStatusPageComponentRow(row: Record<string, unknown>): RawStatusPageComponentRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    statusPageId: String(row.status_page_id),
    monitoredAppId: (row.monitored_app_id as string | null) ?? null,
    environmentId: (row.environment_id as string | null) ?? null,
    monitorId: (row.monitor_id as string | null) ?? null,
    displayName: String(row.display_name),
    sortOrder: Number(row.sort_order),
    isVisible: Boolean(row.is_visible),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function asRow(value: unknown): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function asRows(value: unknown): Record<string, unknown>[] {
  return value as unknown as Record<string, unknown>[];
}

async function getRawStatusPageById(
  userId: string,
  statusPageId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { resource, organizationContext } = await requireResourceAccess(
    userId,
    "status_page",
    statusPageId,
    organizationId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("status_pages")
    .select(STATUS_PAGE_SELECT)
    .eq("id", resource.id)
    .eq("organization_id", resource.organization_id)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  return {
    organizationContext,
    statusPage: mapStatusPageRow(asRow(data)),
  };
}

async function getRawStatusPageComponentById(
  userId: string,
  componentId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { resource, organizationContext } = await requireResourceAccess(
    userId,
    "status_page_component",
    componentId,
    organizationId,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("status_page_components")
    .select(STATUS_PAGE_COMPONENT_SELECT)
    .eq("id", resource.id)
    .eq("organization_id", resource.organization_id)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  return {
    organizationContext,
    component: mapStatusPageComponentRow(asRow(data)),
  };
}

async function listRawComponentsForPage(
  organizationId: string,
  statusPageId: string,
  adminClient: AdminLike,
) {
  const { data, error } = await adminClient
    .from("status_page_components")
    .select(STATUS_PAGE_COMPONENT_SELECT)
    .eq("organization_id", organizationId)
    .eq("status_page_id", statusPageId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw mapPostgresError(error);
  }

  return asRows(data ?? []).map((row) => mapStatusPageComponentRow(row));
}

async function assertStatusPageComponentPageMatch(
  component: RawStatusPageComponentRecord,
  statusPageId: string,
) {
  if (component.statusPageId !== statusPageId) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }
}

async function assertComponentMapping(
  userId: string,
  organizationId: string,
  input: {
    monitoredAppId?: string | null;
    environmentId?: string | null;
    monitorId?: string | null;
  },
  adminClient: AdminLike,
) {
  const app = input.monitoredAppId
    ? await getAppById(userId, input.monitoredAppId, organizationId, adminClient)
    : null;
  const environment = input.environmentId
    ? await getEnvironmentById(userId, input.environmentId, organizationId, adminClient)
    : null;
  const monitor = input.monitorId
    ? await getMonitorById(userId, input.monitorId, organizationId, adminClient)
    : null;

  if (environment && app && environment.appId !== app.id) {
    throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
  }

  if (monitor && app && monitor.appId !== app.id) {
    throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
  }

  if (monitor && environment && (monitor.environmentId ?? null) !== environment.id) {
    throw new ApiError(400, "INVALID_RELATION", "The selected related record is invalid.");
  }

  return { app, environment, monitor };
}

async function loadActiveMaintenanceWindows(
  organizationId: string,
  adminClient: AdminLike,
) {
  const now = new Date().toISOString();
  const { data, error } = await adminClient
    .from("maintenance_windows")
    .select("id, scope, title, app_id, environment_id, monitor_id")
    .eq("organization_id", organizationId)
    .lte("starts_at", now)
    .gte("ends_at", now);

  if (error) {
    throw mapPostgresError(error);
  }

  return asRows(data ?? []).map((row) => ({
    id: String(row.id),
    scope: String(row.scope),
    title: String(row.title),
    appId: (row.app_id as string | null) ?? null,
    environmentId: (row.environment_id as string | null) ?? null,
    monitorId: (row.monitor_id as string | null) ?? null,
  }));
}

async function loadLatestResultsForMonitors(
  userId: string,
  organizationId: string,
  monitorIds: string[],
  adminClient: AdminLike,
) {
  const entries = await Promise.all(
    monitorIds.map(async (monitorId) => {
      const results = await listMonitorResultsForMonitor(
        userId,
        monitorId,
        organizationId,
        { limit: 1 },
        adminClient,
      );

      return [monitorId, results[0] ?? null] as const;
    }),
  );

  return new Map(
    entries.filter((entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1])),
  );
}

export async function listStatusPagesForOrganization(
  userId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeStatusPageSummary[]> {
  const organizationContext = await requireOrgMembership(userId, organizationId, adminClient);
  const { data, error } = await adminClient
    .from("status_pages")
    .select(STATUS_PAGE_SELECT)
    .eq("organization_id", organizationContext.organization.id)
    .order("name", { ascending: true });

  if (error) {
    throw mapPostgresError(error);
  }

  const pages = asRows(data ?? []).map((row) => mapStatusPageRow(row));
  const componentCounts = await Promise.all(
    pages.map(async (page) => {
      const components = await listRawComponentsForPage(
        organizationContext.organization.id,
        page.id,
        adminClient,
      );

      return [page.id, components.length] as const;
    }),
  );
  const componentCountByPageId = new Map(componentCounts);

  return pages.map((page) =>
    toSafeStatusPageSummary(page, componentCountByPageId.get(page.id) ?? 0),
  );
}

export async function getStatusPageById(
  userId: string,
  statusPageId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { statusPage } = await getRawStatusPageById(
    userId,
    statusPageId,
    organizationId,
    adminClient,
  );
  const components = await listRawComponentsForPage(
    statusPage.organizationId,
    statusPage.id,
    adminClient,
  );

  return {
    page: toSafeStatusPageSummary(statusPage, components.length),
    components: components.map((component) => toSafeStatusPageComponentSummary(component)),
  };
}

export async function createStatusPage(
  context: StatusPageServiceContext,
  input: z.infer<typeof createStatusPageSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { data, error } = await adminClient
    .from("status_pages")
    .insert({
      organization_id: context.organization.id,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      is_public: input.isPublic ?? false,
      created_by: context.userId,
    })
    .select(STATUS_PAGE_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const statusPage = mapStatusPageRow(asRow(data));

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "status_pages",
    targetId: statusPage.id,
    metadata: {
      statusPage: sanitizeStatusPageForAudit(statusPage),
    },
    request: context.request,
  });

  return toSafeStatusPageSummary(statusPage, 0);
}

export async function updateStatusPage(
  context: StatusPageServiceContext,
  statusPageId: string,
  input: z.infer<typeof updateStatusPageSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { statusPage: before } = await getRawStatusPageById(
    context.userId,
    statusPageId,
    context.organization.id,
    adminClient,
  );

  const { data, error } = await adminClient
    .from("status_pages")
    .update({
      name: input.name ?? before.name,
      slug: input.slug ?? before.slug,
      description:
        input.description === undefined ? before.description : (input.description ?? null),
      is_public: input.isPublic ?? before.isPublic,
    })
    .eq("id", before.id)
    .eq("organization_id", before.organizationId)
    .select(STATUS_PAGE_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const after = mapStatusPageRow(asRow(data));

  await writeAuditLog({
    organizationId: after.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "status_pages",
    targetId: after.id,
    metadata: {
      before: sanitizeStatusPageForAudit(before),
      after: sanitizeStatusPageForAudit(after),
    },
    request: context.request,
  });

  const components = await listRawComponentsForPage(after.organizationId, after.id, adminClient);
  return toSafeStatusPageSummary(after, components.length);
}

export async function deleteStatusPage(
  context: StatusPageServiceContext,
  statusPageId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { statusPage } = await getRawStatusPageById(
    context.userId,
    statusPageId,
    context.organization.id,
    adminClient,
  );

  const { error } = await adminClient
    .from("status_pages")
    .delete()
    .eq("id", statusPage.id)
    .eq("organization_id", statusPage.organizationId);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: statusPage.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "delete",
    targetTable: "status_pages",
    targetId: statusPage.id,
    metadata: {
      deleted: sanitizeStatusPageForAudit(statusPage),
    },
    request: context.request,
  });

  return { id: statusPage.id, deleted: true };
}

export async function createStatusPageComponent(
  context: StatusPageServiceContext,
  statusPageId: string,
  input: z.infer<typeof createStatusPageComponentSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { statusPage } = await getRawStatusPageById(
    context.userId,
    statusPageId,
    context.organization.id,
    adminClient,
  );

  await assertComponentMapping(context.userId, context.organization.id, input, adminClient);

  const { data, error } = await adminClient
    .from("status_page_components")
    .insert({
      organization_id: context.organization.id,
      status_page_id: statusPage.id,
      monitored_app_id: input.monitoredAppId ?? null,
      environment_id: input.environmentId ?? null,
      monitor_id: input.monitorId ?? null,
      display_name: input.displayName,
      sort_order: input.sortOrder ?? 0,
      is_visible: input.isVisible ?? true,
    })
    .select(STATUS_PAGE_COMPONENT_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const component = mapStatusPageComponentRow(asRow(data));

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "status_page_components",
    targetId: component.id,
    metadata: {
      statusPageId: statusPage.id,
      component: sanitizeStatusPageComponentForAudit(component),
    },
    request: context.request,
  });

  return toSafeStatusPageComponentSummary(component);
}

export async function updateStatusPageComponent(
  context: StatusPageServiceContext,
  statusPageId: string,
  componentId: string,
  input: z.infer<typeof updateStatusPageComponentSchema>,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { component: before } = await getRawStatusPageComponentById(
    context.userId,
    componentId,
    context.organization.id,
    adminClient,
  );
  await assertStatusPageComponentPageMatch(before, statusPageId);

  const nextMapping = {
    monitoredAppId:
      input.monitoredAppId === undefined ? before.monitoredAppId : (input.monitoredAppId ?? null),
    environmentId:
      input.environmentId === undefined ? before.environmentId : (input.environmentId ?? null),
    monitorId: input.monitorId === undefined ? before.monitorId : (input.monitorId ?? null),
  };

  await assertComponentMapping(context.userId, context.organization.id, nextMapping, adminClient);

  const { data, error } = await adminClient
    .from("status_page_components")
    .update({
      monitored_app_id: nextMapping.monitoredAppId,
      environment_id: nextMapping.environmentId,
      monitor_id: nextMapping.monitorId,
      display_name: input.displayName ?? before.displayName,
      sort_order: input.sortOrder ?? before.sortOrder,
      is_visible: input.isVisible ?? before.isVisible,
    })
    .eq("id", before.id)
    .eq("organization_id", before.organizationId)
    .select(STATUS_PAGE_COMPONENT_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const after = mapStatusPageComponentRow(asRow(data));

  await writeAuditLog({
    organizationId: after.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "status_page_components",
    targetId: after.id,
    metadata: {
      before: sanitizeStatusPageComponentForAudit(before),
      after: sanitizeStatusPageComponentForAudit(after),
    },
    request: context.request,
  });

  return toSafeStatusPageComponentSummary(after);
}

export async function deleteStatusPageComponent(
  context: StatusPageServiceContext,
  statusPageId: string,
  componentId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { component } = await getRawStatusPageComponentById(
    context.userId,
    componentId,
    context.organization.id,
    adminClient,
  );
  await assertStatusPageComponentPageMatch(component, statusPageId);

  const { error } = await adminClient
    .from("status_page_components")
    .delete()
    .eq("id", component.id)
    .eq("organization_id", component.organizationId);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: component.organizationId,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "delete",
    targetTable: "status_page_components",
    targetId: component.id,
    metadata: {
      deleted: sanitizeStatusPageComponentForAudit(component),
    },
    request: context.request,
  });

  return { id: component.id, deleted: true };
}

export async function getStatusPagePreview(
  userId: string,
  statusPageId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeStatusPagePreview> {
  const { statusPage, organizationContext } = await getRawStatusPageById(
    userId,
    statusPageId,
    organizationId,
    adminClient,
  );
  const rawComponents = (await listRawComponentsForPage(
    statusPage.organizationId,
    statusPage.id,
    adminClient,
  )).filter((component) => component.isVisible);

  const [apps, monitors, incidents, maintenanceWindows] = await Promise.all([
    listAppsForOrganization(statusPage.organizationId, adminClient),
    listMonitorsForOrganization(statusPage.organizationId, adminClient),
    listIncidentsForOrganization(
      userId,
      organizationContext.organization.id,
      "active",
      adminClient,
    ),
    loadActiveMaintenanceWindows(statusPage.organizationId, adminClient),
  ]);

  const environments = (
    await Promise.all(
      apps.map((app) => listEnvironmentsForApp(statusPage.organizationId, app.id, adminClient)),
    )
  ).flat();

  const monitorIds = Array.from(new Set(monitors.map((monitor) => monitor.id)));
  const [latestResultsByMonitorId, heartbeatEntries] = await Promise.all([
    loadLatestResultsForMonitors(userId, statusPage.organizationId, monitorIds, adminClient),
    Promise.all(
      monitors
        .filter((monitor) => monitor.type === "heartbeat")
        .map(async (monitor) => [monitor.id, await getHeartbeatByMonitorId(statusPage.organizationId, monitor.id, adminClient)] as const),
    ),
  ]);

  const heartbeatsByMonitorId = new Map(
    heartbeatEntries.filter((entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1])),
  );

  const components = rawComponents.map((component) =>
    buildStatusPagePreviewComponent(component, {
      appsById: new Map(apps.map((app) => [app.id, app])),
      environmentsById: new Map(environments.map((environment) => [environment.id, environment])),
      monitorsById: new Map(monitors.map((monitor) => [monitor.id, monitor])),
      latestResultsByMonitorId,
      activeIncidents: incidents,
      activeMaintenanceWindows: maintenanceWindows,
      heartbeatsByMonitorId,
    }),
  );

  return {
    page: toSafeStatusPageSummary(statusPage, components.length),
    overallStatus: deriveOverallStatus(components),
    latestCheckedAt: derivePreviewTimestamps(components),
    incidents: uniqueIncidentEvidence(components),
    components,
  };
}
