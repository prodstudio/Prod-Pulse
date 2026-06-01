import Link from "next/link";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { requireAppSession } from "@/lib/server/auth/guards";
import { listAppsForOrganization } from "@/lib/server/apps/app-service";
import { listIncidentsForOrganization } from "@/lib/server/incidents/incident-service";
import { listMonitorsForOrganization } from "@/lib/server/monitors/monitor-service";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href?: string;
}) {
  const content = (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAppSession();
  const params = (await searchParams) ?? {};
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const status = typeof params.status === "string" ? params.status : undefined;

  if (!session.organizationContext) {
    return <NoOrganizationState errorCode={errorCode} status={status} />;
  }

  const organizationId = session.organizationContext.organization.id;
  const [apps, monitors, activeIncidents] = await Promise.all([
    listAppsForOrganization(organizationId),
    listMonitorsForOrganization(organizationId),
    listIncidentsForOrganization(session.user.id, organizationId, "active"),
  ]);

  const monitorStatusCounts = monitors.reduce<Record<string, number>>((acc, monitor) => {
    acc[monitor.status] = (acc[monitor.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Command center
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {session.organizationContext.organization.name}
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          This dashboard reflects persisted apps, monitors, and incident state only.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total apps" value={apps.length} href="/apps" />
        <StatCard label="Total monitors" value={monitors.length} href="/monitors" />
        <StatCard label="Active incidents" value={activeIncidents.length} href="/incidents" />
        <StatCard
          label="Operational monitors"
          value={monitorStatusCounts.operational ?? 0}
          href="/monitors"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Apps in scope</h2>
              <p className="text-sm text-muted-foreground">
                Current organization inventory only.
              </p>
            </div>
            <Link className="text-sm font-medium text-primary" href="/apps">
              View apps
            </Link>
          </div>
          {apps.length === 0 ? (
            <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              No apps exist for this organization yet.
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {apps.slice(0, 6).map((app) => (
                <li
                  key={app.id}
                  className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3"
                >
                  <div>
                    <Link
                      href={`/apps/${app.id}`}
                      className="font-medium tracking-tight text-foreground"
                    >
                      {app.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">{app.slug}</p>
                  </div>
                  <span className="rounded-full border border-border px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {app.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold tracking-tight">Monitor status mix</h2>
          <p className="text-sm text-muted-foreground">Persisted monitor state only.</p>
          {monitors.length === 0 ? (
            <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              No monitors exist for this organization yet.
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {Object.entries(monitorStatusCounts).map(([status, count]) => (
                <li
                  key={status}
                  className="flex items-center justify-between rounded-md border border-border px-4 py-3"
                >
                  <span className="text-sm font-medium capitalize">{status}</span>
                  <span className="text-sm text-muted-foreground">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Active incidents</h2>
            <p className="text-sm text-muted-foreground">
              Current unresolved incidents from scheduled monitor outcomes.
            </p>
          </div>
          <Link className="text-sm font-medium text-primary" href="/incidents">
            View incidents
          </Link>
        </div>
        {activeIncidents.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            No active incidents are currently open.
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {activeIncidents.slice(0, 5).map((incident) => (
              <li
                key={incident.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border px-4 py-3"
              >
                <div>
                  <Link href={`/incidents/${incident.id}`} className="font-medium tracking-tight">
                    {incident.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {incident.appName ?? "Unknown app"} · {incident.monitorName ?? "Unknown monitor"}
                  </p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <p className="capitalize">{incident.status}</p>
                  <p className="capitalize">{incident.severity}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
