import { notFound } from "next/navigation";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { ApiError } from "@/lib/server/api/errors";
import { requireAppSession } from "@/lib/server/auth/guards";
import { getMonitorById } from "@/lib/server/monitors/monitor-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    monitorId: string;
  }>;
};

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6">{value}</p>
    </div>
  );
}

export default async function MonitorDetailPage({ params }: PageProps) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const { monitorId } = await params;
  const monitor = await getMonitorById(
    session.user.id,
    monitorId,
    session.organizationContext.organization.id,
  ).catch((error) => {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  });

  if (!monitor) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Monitor detail
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{monitor.name}</h1>
        <p className="text-sm text-muted-foreground">
          {monitor.type} · {monitor.status} · every {monitor.intervalSeconds}s
        </p>
        {monitor.description ? (
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            {monitor.description}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ConfigRow label="Target" value={monitor.targetSummary ?? "Heartbeat-only monitor"} />
        <ConfigRow label="Request method" value={monitor.requestMethod ?? "Not set"} />
        <ConfigRow label="Next check" value={monitor.nextCheckAt ?? "Not scheduled"} />
        <ConfigRow label="Timeout" value={`${monitor.timeoutMs} ms`} />
        <ConfigRow
          label="Failure threshold"
          value={`${monitor.consecutiveFailureThreshold} consecutive failures`}
        />
        <ConfigRow
          label="Recovery threshold"
          value={`${monitor.consecutiveRecoveryThreshold} consecutive passes`}
        />
        <ConfigRow
          label="Latency threshold"
          value={
            monitor.latencyThresholdMs ? `${monitor.latencyThresholdMs} ms` : "Not configured"
          }
        />
        <ConfigRow
          label="Environment"
          value={monitor.environmentId ?? "App-level monitor without environment binding"}
        />
        <ConfigRow label="Enabled" value={monitor.isEnabled ? "Yes" : "No"} />
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold tracking-tight">Configuration summary</h2>
        {!monitor.hasStoredConfiguration ? (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            No additional configuration has been stored for this monitor yet.
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {monitor.configurationSummary}
          </p>
        )}
      </section>
    </div>
  );
}
