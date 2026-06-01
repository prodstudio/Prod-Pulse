import Link from "next/link";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { requireAppSession } from "@/lib/server/auth/guards";
import { listIncidentsForOrganization } from "@/lib/server/incidents/incident-service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(durationSeconds: number | null) {
  if (durationSeconds == null) {
    return "Unavailable";
  }

  if (durationSeconds < 60) {
    return `${durationSeconds}s`;
  }

  const minutes = Math.floor(durationSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const params = await searchParams;
  const filter =
    typeof params.filter === "string" && ["active", "resolved", "all"].includes(params.filter)
      ? (params.filter as "active" | "resolved" | "all")
      : "active";

  const incidents = await listIncidentsForOrganization(
    session.user.id,
    session.organizationContext.organization.id,
    "all",
  );
  const filteredIncidents = incidents.filter((incident) =>
    filter === "all"
      ? true
      : filter === "resolved"
        ? incident.status === "resolved"
        : incident.status !== "resolved",
  );
  const activeCount = incidents.filter((incident) => incident.status !== "resolved").length;
  const resolvedCount = incidents.filter((incident) => incident.status === "resolved").length;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Incident management
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Incidents</h1>
        <p className="text-sm text-muted-foreground">
          These records come from persisted scheduled monitor results only. No alerting is wired
          in this phase.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Active
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Resolved
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{resolvedCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Organization
          </p>
          <p className="mt-3 text-xl font-semibold tracking-tight">
            {session.organizationContext.organization.name}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          {[
            { value: "active", label: "Active" },
            { value: "resolved", label: "Resolved" },
            { value: "all", label: "All" },
          ].map((option) => (
            <Link
              key={option.value}
              href={`/incidents?filter=${option.value}`}
              className={
                filter === option.value
                  ? "rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
                  : "rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
              }
            >
              {option.label}
            </Link>
          ))}
        </div>

        {filteredIncidents.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            No incidents match this filter yet.
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {filteredIncidents.map((incident) => (
              <li key={incident.id} className="rounded-md border border-border px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/incidents/${incident.id}`}
                        className="text-base font-semibold tracking-tight"
                      >
                        {incident.title}
                      </Link>
                      <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {incident.severity}
                      </span>
                      <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {incident.status}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {incident.appName ?? "Unknown app"} · {incident.monitorName ?? "Unknown monitor"}
                      {incident.environmentName ? ` · ${incident.environmentName}` : ""}
                    </p>
                    {incident.summary ? (
                      <p className="text-sm leading-6 text-muted-foreground">{incident.summary}</p>
                    ) : null}
                  </div>
                  <div className="min-w-44 space-y-1 text-right text-sm text-muted-foreground">
                    <p>Created {formatTimestamp(incident.createdAt)}</p>
                    <p>Updated {formatTimestamp(incident.updatedAt)}</p>
                    <p>Duration {formatDuration(incident.durationSeconds)}</p>
                    {incident.resolvedAt ? <p>Resolved {formatTimestamp(incident.resolvedAt)}</p> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
