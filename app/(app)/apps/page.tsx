import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import {
  createApp,
  createAppSchema,
  listAppsForOrganization,
} from "@/lib/server/apps/app-service";
import {
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";
import { requireAppSession } from "@/lib/server/auth/guards";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";
import {
  getVercelImportSettings,
  importVercelProject,
  listVercelProjectsForImport,
} from "@/lib/server/integrations/vercel-import-service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AppsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const params = await searchParams;
  const errorMessage = getActionErrorMessage(
    typeof params.error === "string" ? params.error : null,
  );
  const status = typeof params.status === "string" ? params.status : null;
  const canManage = canManageOperationalConfig(session.organizationContext.membership.role);
  const apps = await listAppsForOrganization(session.organizationContext.organization.id);
  const vercelImportSettings = getVercelImportSettings();
  const vercelProjects =
    canManage && vercelImportSettings.isConfigured
      ? await listVercelProjectsForImport({
          userId: session.user.id,
          organization: session.organizationContext.organization,
          membership: session.organizationContext.membership,
        })
      : [];

  async function createAppAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageOperationalConfig(actionSession.organizationContext.membership.role)) {
      redirect("/apps?error=forbidden");
    }

    let redirectTarget = "/apps?status=created";

    try {
      const app = await createApp(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        parseSchema(createAppSchema, {
          name: String(formData.get("name") ?? ""),
          slug: String(formData.get("slug") ?? ""),
          description: formData.get("description")
            ? String(formData.get("description"))
            : null,
          ownerTeam: formData.get("ownerTeam") ? String(formData.get("ownerTeam")) : null,
          status: String(formData.get("status") ?? "unknown"),
        }),
      );

      redirectTarget = `/apps/${app.id}?status=app_created`;
    } catch (error) {
      unstable_rethrow(error);
      redirectTarget = `/apps?error=${getActionErrorRedirectValue(error)}`;
    }

    redirect(redirectTarget);
  }

  async function importVercelProjectAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageOperationalConfig(actionSession.organizationContext.membership.role)) {
      redirect("/apps?error=forbidden");
    }

    let redirectTarget = "/apps?status=vercel_imported";

    try {
      const result = await importVercelProject({
        userId: actionSession.user.id,
        organization: actionSession.organizationContext.organization,
        membership: actionSession.organizationContext.membership,
      }, {
        projectId: String(formData.get("projectId") ?? ""),
      });

      redirectTarget = `/apps/${result.app.id}?status=vercel_imported`;
    } catch (error) {
      unstable_rethrow(error);
      redirectTarget = `/apps?error=${getActionErrorRedirectValue(error)}`;
    }

    redirect(redirectTarget);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Inventory
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Monitored apps</h1>
        <p className="text-sm text-muted-foreground">
          Persisted applications for {session.organizationContext.organization.name}.
        </p>
      </div>

      {errorMessage ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}
      {status ? (
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          App action completed: {status}.
        </div>
      ) : null}

      {canManage ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_1.35fr]">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Create monitored app</h2>
            <form action={createAppAction} className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-medium">Name</span>
                <input
                  name="name"
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  placeholder="Piem"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium">Slug</span>
                <input
                  name="slug"
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  placeholder="piem"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium">Owner team</span>
                <input
                  name="ownerTeam"
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  placeholder="Operations"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium">Status</span>
                <select
                  name="status"
                  defaultValue="unknown"
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  {["unknown", "operational", "degraded", "down", "maintenance"].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm lg:col-span-2">
                <span className="font-medium">Description</span>
                <textarea
                  name="description"
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  placeholder="What this app does and why it is monitored."
                />
              </label>
              <div className="lg:col-span-2">
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Create app
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold tracking-tight">Import Vercel project</h2>
              <p className="text-sm text-muted-foreground">
                Reuse the existing manual onboarding model, but prefill it from a Vercel production alias.
              </p>
            </div>

            {!vercelImportSettings.isConfigured ? (
              <div className="mt-5 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                Configure `VERCEL_IMPORT_TOKEN` and either `VERCEL_IMPORT_TEAM_ID` or
                `VERCEL_IMPORT_TEAM_SLUG` to enable project import.
              </div>
            ) : vercelProjects.length === 0 ? (
              <div className="mt-5 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                No Vercel projects were returned for {vercelImportSettings.teamScopeLabel}.
              </div>
            ) : (
              <ul className="mt-5 space-y-3">
                {vercelProjects.map((project) => (
                  <li key={project.id} className="rounded-md border border-border px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1">
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">{project.slug}</p>
                        <p className="text-sm text-muted-foreground">
                          {project.productionUrl ?? project.importBlockedReason}
                        </p>
                      </div>
                      <form action={importVercelProjectAction}>
                        <input type="hidden" name="projectId" value={project.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-border px-3 py-2 text-sm"
                          disabled={!project.productionUrl}
                        >
                          Import
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-4 text-sm text-muted-foreground">
          App creation requires admin or owner access.
        </div>
      )}

      {apps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-sm text-muted-foreground">
          No monitored apps exist yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/35 text-left text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <tr>
                <th className="px-5 py-4 font-semibold">App</th>
                <th className="px-5 py-4 font-semibold">Status</th>
                <th className="px-5 py-4 font-semibold">Owner team</th>
                <th className="px-5 py-4 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id} className="border-t border-border">
                  <td className="px-5 py-4">
                    <Link href={`/apps/${app.id}`} className="font-medium tracking-tight">
                      {app.name}
                    </Link>
                    <p className="mt-1 text-muted-foreground">{app.slug}</p>
                  </td>
                  <td className="px-5 py-4 capitalize">{app.status}</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {app.ownerTeam ?? "Not set"}
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {new Date(app.createdAt).toLocaleDateString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
