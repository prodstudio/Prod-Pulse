import Link from "next/link";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { requireAppSession } from "@/lib/server/auth/guards";
import { listMonitorsForOrganization } from "@/lib/server/monitors/monitor-service";

export const dynamic = "force-dynamic";

export default async function MonitorsPage() {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const monitors = await listMonitorsForOrganization(session.organizationContext.organization.id);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Monitoring inventory
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Monitors</h1>
          <p className="text-sm text-muted-foreground">
            Monitor definitions stored for {session.organizationContext.organization.name}.
          </p>
        </div>
        <Link
          href="/monitors/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Create monitor
        </Link>
      </div>

      {monitors.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-sm text-muted-foreground">
          No monitors exist yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/35 text-left text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <tr>
                <th className="px-5 py-4 font-semibold">Monitor</th>
                <th className="px-5 py-4 font-semibold">Type</th>
                <th className="px-5 py-4 font-semibold">Target</th>
                <th className="px-5 py-4 font-semibold">Status</th>
                <th className="px-5 py-4 font-semibold">Interval</th>
                <th className="px-5 py-4 font-semibold">Next check</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((monitor) => (
                <tr key={monitor.id} className="border-t border-border">
                  <td className="px-5 py-4">
                    <Link href={`/monitors/${monitor.id}`} className="font-medium">
                      {monitor.name}
                    </Link>
                    <p className="mt-1 text-muted-foreground">{monitor.slug}</p>
                  </td>
                  <td className="px-5 py-4">{monitor.type}</td>
                  <td className="max-w-[22rem] px-5 py-4 text-muted-foreground">
                    <span className="block truncate">
                      {monitor.targetSummary ?? "Heartbeat-only"}
                    </span>
                  </td>
                  <td className="px-5 py-4 capitalize">{monitor.status}</td>
                  <td className="px-5 py-4">{monitor.intervalSeconds}s</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {monitor.nextCheckAt
                      ? new Date(monitor.nextCheckAt).toLocaleString("en-US")
                      : "Not scheduled"}
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
