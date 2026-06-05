import "server-only";

import { ApiError } from "@/lib/server/api/errors";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";
import type { ActiveOrganizationContext } from "@/lib/server/auth/organization-context";
import {
  createApp,
  listAppsForOrganization,
  updateApp,
  type AppSummary,
} from "@/lib/server/apps/app-service";
import {
  createEnvironment,
  listEnvironmentsForApp,
  updateEnvironment,
  type EnvironmentSummary,
} from "@/lib/server/apps/environment-service";
import {
  createMonitor,
  listMonitorsForOrganization,
  updateMonitor,
} from "@/lib/server/monitors/monitor-service";
import type { SafeMonitorSummary } from "@/lib/server/monitors/monitor-sanitization";

type ImportContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

type SafeVercelProject = {
  id: string;
  name: string;
  slug: string;
  productionUrl: string | null;
  importBlockedReason: string | null;
};

type ImportResult = {
  app: AppSummary;
  environment: EnvironmentSummary;
  monitor: SafeMonitorSummary;
  project: SafeVercelProject;
  created: {
    app: boolean;
    environment: boolean;
    monitor: boolean;
  };
};

type FetchLike = typeof fetch;

type VercelImportConfig = {
  token: string;
  teamId: string | null;
  teamSlug: string | null;
};

function requireManagerRole(context: ImportContext) {
  if (!canManageOperationalConfig(context.membership.role)) {
    throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
  }
}

function getVercelImportConfig(): VercelImportConfig | null {
  const token = process.env.VERCEL_IMPORT_TOKEN?.trim() ?? "";
  const teamId = process.env.VERCEL_IMPORT_TEAM_ID?.trim() ?? null;
  const teamSlug = process.env.VERCEL_IMPORT_TEAM_SLUG?.trim() ?? null;

  if (!token || (!teamId && !teamSlug)) {
    return null;
  }

  return {
    token,
    teamId,
    teamSlug,
  };
}

export function getVercelImportSettings() {
  const config = getVercelImportConfig();

  return {
    isConfigured: Boolean(config),
    teamScopeLabel: config?.teamSlug ?? config?.teamId ?? null,
  };
}

function buildQuery(config: VercelImportConfig) {
  const params = new URLSearchParams();
  params.set("limit", "100");

  if (config.teamId) {
    params.set("teamId", config.teamId);
  } else if (config.teamSlug) {
    params.set("slug", config.teamSlug);
  }

  return params.toString();
}

function slugifyProjectName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (slug.length < 2) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed.");
  }

  return slug.slice(0, 80);
}

function toHttpsUrl(hostname: string) {
  return `https://${hostname.replace(/^https?:\/\//, "")}`;
}

function pickProductionUrl(project: Record<string, unknown>) {
  const aliases = Array.isArray(project.alias) ? project.alias : [];
  const productionAlias = aliases.find((alias) => {
    if (typeof alias !== "object" || alias === null) {
      return false;
    }

    const entry = alias as Record<string, unknown>;
    return entry.target === "PRODUCTION" || entry.environment === "production";
  });

  if (
    productionAlias &&
    typeof productionAlias === "object" &&
    productionAlias !== null &&
    typeof (productionAlias as Record<string, unknown>).alias === "string"
  ) {
    return toHttpsUrl(String((productionAlias as Record<string, unknown>).alias));
  }

  return null;
}

function mapProject(project: Record<string, unknown>): SafeVercelProject {
  const productionUrl = pickProductionUrl(project);
  const name = String(project.name ?? "");

  return {
    id: String(project.id),
    name,
    slug: slugifyProjectName(name),
    productionUrl,
    importBlockedReason: productionUrl ? null : "No production alias or domain is available yet.",
  };
}

async function fetchVercelProjects(fetchImpl: FetchLike = fetch): Promise<SafeVercelProject[]> {
  const config = getVercelImportConfig();

  if (!config) {
    return [];
  }

  const response = await fetchImpl(
    `https://api.vercel.com/v10/projects?${buildQuery(config)}`,
    {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new ApiError(500, "request_failed", "The request could not be completed.");
  }

  const payload = (await response.json()) as unknown;
  const projects = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { projects?: unknown[] })?.projects)
      ? ((payload as { projects: unknown[] }).projects ?? [])
      : [];

  return projects
    .filter((project): project is Record<string, unknown> => typeof project === "object" && project !== null)
    .map(mapProject)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listVercelProjectsForImport(
  context: ImportContext,
  fetchImpl: FetchLike = fetch,
) {
  requireManagerRole(context);
  return fetchVercelProjects(fetchImpl);
}

export async function importVercelProject(
  context: ImportContext,
  input: {
    projectId: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<ImportResult> {
  requireManagerRole(context);

  const projects = await fetchVercelProjects(fetchImpl);
  const project = projects.find((entry) => entry.id === input.projectId);

  if (!project) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  if (!project.productionUrl) {
    throw new ApiError(400, "request_failed", "The request could not be completed.");
  }

  const apps = await listAppsForOrganization(context.organization.id);
  const existingApp = apps.find((app) => app.slug === project.slug);

  const app = existingApp
    ? await updateApp(context, existingApp.id, {
        name: project.name,
        description: existingApp.description ?? `Imported from Vercel project ${project.name}.`,
        ownerTeam: existingApp.ownerTeam ?? "Vercel",
      })
    : await createApp(context, {
        name: project.name,
        slug: project.slug,
        description: `Imported from Vercel project ${project.name}.`,
        ownerTeam: "Vercel",
        status: "unknown",
      });

  const environments = await listEnvironmentsForApp(context.organization.id, app.id);
  const environmentSlug = `${project.slug}-production`;
  const existingEnvironment = environments.find((environment) => environment.slug === environmentSlug);

  const environment = existingEnvironment
    ? await updateEnvironment(context, existingEnvironment.id, {
        name: "Production",
        type: "production",
        baseUrl: project.productionUrl,
      })
    : await createEnvironment(context, app.id, {
        name: "Production",
        slug: environmentSlug,
        type: "production",
        baseUrl: project.productionUrl,
        status: "unknown",
      });

  const monitors = await listMonitorsForOrganization(context.organization.id);
  const monitorSlug = `${project.slug}-uptime`;
  const existingMonitor = monitors.find((monitor) => monitor.slug === monitorSlug);

  const monitor = existingMonitor
    ? await updateMonitor(context, existingMonitor.id, {
        appId: app.id,
        environmentId: environment.id,
        name: `${project.name} uptime`,
        type: "http",
        requestMethod: "GET",
        targetUrl: project.productionUrl,
        expectedStatusCodes: [200],
        intervalSeconds: 300,
        timeoutMs: 10000,
        isEnabled: true,
      })
    : await createMonitor(context, {
        appId: app.id,
        environmentId: environment.id,
        name: `${project.name} uptime`,
        slug: monitorSlug,
        type: "http",
        requestMethod: "GET",
        targetUrl: project.productionUrl,
        expectedStatusCodes: [200],
        intervalSeconds: 300,
        timeoutMs: 10000,
        isEnabled: true,
        status: "unknown",
        description: `Imported from Vercel project ${project.name}.`,
      });

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "monitored_apps",
    targetId: app.id,
    metadata: {
      action: "import_vercel_project",
      projectId: project.id,
      projectName: project.name,
      appId: app.id,
      environmentId: environment.id,
      monitorId: monitor.id,
    },
    request: context.request,
  });

  return {
    app,
    environment,
    monitor,
    project,
    created: {
      app: !existingApp,
      environment: !existingEnvironment,
      monitor: !existingMonitor,
    },
  };
}
