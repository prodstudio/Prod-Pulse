import Link from "next/link";
import { notFound } from "next/navigation";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { getAppById } from "@/lib/server/apps/app-service";
import { listEnvironmentsForApp } from "@/lib/server/apps/environment-service";
import { requireAppSession } from "@/lib/server/auth/guards";
import { listMonitorsForOrganization } from "@/lib/server/monitors/monitor-service";
import { ApiError } from "@/lib/server/api/errors";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    appId: string;
  }>;
};

export default async function AppDetailPage({ params }: PageProps) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const { appId } = await params;
  const [appResult, environments, monitors] = await Promise.all([
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
  ]);

  if (!appResult) {
    notFound();
  }

  const app = appResult;
  const relatedMonitors = monitors.filter((monitor) => monitor.appId === appId);

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
            <Link className="text-sm font-medium text-primary" href="/monitors/new">
              Create monitor
            </Link>
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
