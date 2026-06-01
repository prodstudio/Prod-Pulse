import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { NoOrganizationState } from "@/components/layout/no-organization-state";
import {
  ApiError,
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { requireAppSession, requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canRunMonitors } from "@/lib/server/auth/permissions";
import { executeManualMonitorRun } from "@/lib/server/monitoring/execute";
import { listMonitorResultsForMonitor } from "@/lib/server/monitoring/result-service";
import { getMonitorById } from "@/lib/server/monitors/monitor-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    monitorId: string;
  }>;
  searchParams: Promise<{
    runError?: string;
    runStatus?: string;
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

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function MonitorDetailPage({ params, searchParams }: PageProps) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const { monitorId } = await params;
  const [monitor, results, statusParams] = await Promise.all([
    getMonitorById(
      session.user.id,
      monitorId,
      session.organizationContext.organization.id,
    ).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }

      throw error;
    }),
    listMonitorResultsForMonitor(
      session.user.id,
      monitorId,
      session.organizationContext.organization.id,
      { limit: 20 },
    ),
    searchParams,
  ]);

  if (!monitor) {
    notFound();
  }

  const canRun = canRunMonitors(session.organizationContext.membership.role);
  const latestResult = results[0] ?? null;
  const errorMessage = getActionErrorMessage(statusParams.runError);

  async function runMonitorAction() {
    "use server";

    try {
      const user = await requireUser();
      const organizationContext = await requireOrgMembership(user.id);

      if (!canRunMonitors(organizationContext.membership.role)) {
        throw new ApiError(
          403,
          "ORG_ROLE_REQUIRED",
          "This action requires responder, admin, or owner access.",
        );
      }

      await executeManualMonitorRun(
        {
          userId: user.id,
          organization: organizationContext.organization,
          membership: organizationContext.membership,
        },
        monitorId,
      );

      revalidatePath(`/monitors/${monitorId}`);
      redirect(`/monitors/${monitorId}?runStatus=success`);
    } catch (error) {
      redirect(`/monitors/${monitorId}?runError=${getActionErrorRedirectValue(error)}`);
    }
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
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {canRun ? (
            <form action={runMonitorAction}>
              <Button type="submit">Run monitor now</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Manual runs require responder, admin, or owner access.
            </p>
          )}
          {statusParams.runStatus === "success" ? (
            <p className="text-sm text-emerald-600">Manual run completed and result stored.</p>
          ) : null}
          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        </div>
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

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.4fr]">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold tracking-tight">Latest result</h2>
          {!latestResult ? (
            <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              No persisted results yet. Manual runs will write the first result row.
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <ConfigRow label="Status" value={latestResult.status} />
              <ConfigRow label="Checked at" value={formatTimestamp(latestResult.checkedAt)} />
              <ConfigRow
                label="Duration"
                value={
                  latestResult.durationMs == null ? "Not captured" : `${latestResult.durationMs} ms`
                }
              />
              <ConfigRow
                label="HTTP status"
                value={latestResult.httpStatus == null ? "Not applicable" : String(latestResult.httpStatus)}
              />
              <ConfigRow
                label="Error summary"
                value={latestResult.errorSummary ?? "No error recorded"}
              />
              <ConfigRow
                label="Response summary"
                value={latestResult.responseSummary ?? "No response excerpt stored"}
              />
              <ConfigRow
                label="Metadata summary"
                value={latestResult.metadataSummary ?? "No additional summary"}
              />
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold tracking-tight">Result history</h2>
          {results.length === 0 ? (
            <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              No monitor results have been stored yet.
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {results.map((result) => (
                <li key={result.id} className="rounded-md border border-border px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium capitalize">{result.status}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatTimestamp(result.checkedAt)} · trigger {result.triggerSource}
                      </p>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <p>{result.durationMs == null ? "No duration" : `${result.durationMs} ms`}</p>
                      <p>
                        {result.httpStatus == null
                          ? "No HTTP status"
                          : `HTTP ${result.httpStatus}`}
                      </p>
                    </div>
                  </div>
                  {result.errorSummary ? (
                    <p className="mt-3 text-sm text-destructive">{result.errorSummary}</p>
                  ) : null}
                  {result.responseSummary ? (
                    <p className="mt-2 text-sm text-muted-foreground">{result.responseSummary}</p>
                  ) : null}
                  {result.assertionSummary ? (
                    <p className="mt-2 text-sm text-muted-foreground">{result.assertionSummary}</p>
                  ) : null}
                  {result.metadataSummary ? (
                    <p className="mt-2 text-sm text-muted-foreground">{result.metadataSummary}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
