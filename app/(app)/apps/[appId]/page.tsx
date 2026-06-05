import Link from "next/link";
import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { getAppById } from "@/lib/server/apps/app-service";
import {
  createEnvironment,
  createEnvironmentSchema,
  listEnvironmentsForApp,
} from "@/lib/server/apps/environment-service";
import { requireAppSession } from "@/lib/server/auth/guards";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";
import { listMonitorsForOrganization } from "@/lib/server/monitors/monitor-service";
import { ApiError } from "@/lib/server/api/errors";
import {
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    appId: string;
  }>;
  searchParams: Promise<{
    error?: string;
    status?: string;
  }>;
};

export default async function AppDetailPage({ params, searchParams }: PageProps) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const { appId } = await params;
  const [appResult, environments, monitors, statusParams] = await Promise.all([
    getAppById(session.user.id, appId, session.organizationContext.organization.id).catch(
      (error) => {
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }

        throw error;
      },
    ),
    listEnvironmentsForApp(session.organizationContext.organization.id, appId),
    listMonitorsForOrganization(session.organizationContext.organization.id),
    searchParams,
  ]);

  if (!appResult) {
    notFound();
  }

  const app = appResult;
  const relatedMonitors = monitors.filter((monitor) => monitor.appId === appId);
  const canManage = canManageOperationalConfig(session.organizationContext.membership.role);
  const errorMessage = getActionErrorMessage(statusParams.error);
  const status = statusParams.status ?? null;
  const createMonitorHref =
    environments.length === 1
      ? `/monitors/new?appId=${app.id}&environmentId=${environments[0]?.id}`
      : `/monitors/new?appId=${app.id}`;

  async function createEnvironmentAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageOperationalConfig(actionSession.organizationContext.membership.role)) {
      redirect(`/apps/${appId}?error=forbidden`);
    }

    let redirectTarget = `/apps/${appId}?status=environment_created`;

    try {
      await createEnvironment(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        appId,
        parseSchema(createEnvironmentSchema, {
          name: String(formData.get("name") ?? ""),
          slug: String(formData.get("slug") ?? ""),
          type: String(formData.get("type") ?? "production"),
          baseUrl: formData.get("baseUrl") ? String(formData.get("baseUrl")) : null,
          status: String(formData.get("status") ?? "unknown"),
        }),
      );
    } catch (error) {
      unstable_rethrow(error);
      redirectTarget = `/apps/${appId}?error=${getActionErrorRedirectValue(error)}`;
    }

    redirect(redirectTarget);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          App detail
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{app.name}</h1>
        <p className="text-sm text-muted-foreground">
          {app.slug} · status {app.status}
        </p>
        {app.description ? (
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            {app.description}
          </p>
        ) : null}
      </section>

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

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Owner team
          </p>
          <p className="mt-3 text-lg font-semibold">{app.ownerTeam ?? "Not set"}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Environments
          </p>
          <p className="mt-3 text-lg font-semibold">{environments.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Related monitors
          </p>
          <p className="mt-3 text-lg font-semibold">{relatedMonitors.length}</p>
        </div>
      </section>

      {canManage ? (
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Create environment</h2>
              <p className="text-sm text-muted-foreground">
                Add the production or staging target before attaching monitors.
              </p>
            </div>
            <Link className="text-sm font-medium text-primary" href={createMonitorHref}>
              Skip to monitor creation
            </Link>
          </div>
          <form action={createEnvironmentAction} className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium">Name</span>
              <input
                name="name"
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                placeholder="Production"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Slug</span>
              <input
                name="slug"
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                placeholder={`${app.slug}-production`}
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Type</span>
              <select
                name="type"
                defaultValue="production"
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              >
                {["production", "staging", "preview", "development", "other"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
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
              <span className="font-medium">Base URL</span>
              <input
                name="baseUrl"
                type="url"
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                placeholder="https://app.example.com"
              />
            </label>
            <div className="lg:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Create environment
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold tracking-tight">Environments</h2>
          {environments.length === 0 ? (
            <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              No environments exist for this app yet.
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {environments.map((environment) => (
                <li key={environment.id} className="rounded-md border border-border px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">{environment.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {environment.slug} · {environment.type}
                      </p>
                    </div>
                    <span className="text-sm capitalize text-muted-foreground">
                      {environment.status}
                    </span>
                  </div>
                  {environment.baseUrl ? (
                    <p className="mt-3 text-sm text-muted-foreground">{environment.baseUrl}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">Monitors</h2>
            {canManage ? (
              <Link className="text-sm font-medium text-primary" href={createMonitorHref}>
                Create monitor
              </Link>
            ) : null}
          </div>
          {relatedMonitors.length === 0 ? (
            <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              No monitors are attached to this app yet.
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {relatedMonitors.map((monitor) => (
                <li
                  key={monitor.id}
                  className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3"
                >
                  <div>
                    <Link href={`/monitors/${monitor.id}`} className="font-medium">
                      {monitor.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {monitor.type} · every {monitor.intervalSeconds}s
                    </p>
                  </div>
                  <span className="text-sm capitalize text-muted-foreground">
                    {monitor.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
