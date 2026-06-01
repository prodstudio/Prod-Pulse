import { redirect } from "next/navigation";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import {
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";
import { listAppsForOrganization } from "@/lib/server/apps/app-service";
import { listEnvironmentsForApp } from "@/lib/server/apps/environment-service";
import { requireAppSession } from "@/lib/server/auth/guards";
import { canManageHeartbeats } from "@/lib/server/auth/permissions";
import {
  createHeartbeat,
  createHeartbeatSchema,
  deleteHeartbeat,
  listHeartbeatsForOrganization,
  rotateHeartbeatToken,
  updateHeartbeat,
} from "@/lib/server/heartbeats/heartbeat-service";
import { listMonitorsForOrganization } from "@/lib/server/monitors/monitor-service";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function HeartbeatsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const organization = session.organizationContext.organization;
  const canMutate = canManageHeartbeats(session.organizationContext.membership.role);
  const apps = await listAppsForOrganization(organization.id);
  const environments = (
    await Promise.all(
      apps.map((app) => listEnvironmentsForApp(organization.id, app.id)),
    )
  ).flat();
  const [heartbeats, monitors, params] = await Promise.all([
    listHeartbeatsForOrganization(session.user.id, organization.id),
    listMonitorsForOrganization(organization.id),
    searchParams,
  ]);

  const heartbeatMonitors = monitors.filter((monitor) => monitor.type === "heartbeat");
  const errorMessage = getActionErrorMessage(
    typeof params.error === "string" ? params.error : null,
  );
  const status = typeof params.status === "string" ? params.status : null;

  async function createHeartbeatAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageHeartbeats(actionSession.organizationContext.membership.role)) {
      redirect("/heartbeats?error=forbidden");
    }

    try {
      await createHeartbeat(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        parseSchema(createHeartbeatSchema, {
          appId: String(formData.get("appId") ?? ""),
          environmentId: formData.get("environmentId")
            ? String(formData.get("environmentId"))
            : null,
          monitorId: String(formData.get("monitorId") ?? ""),
          name: String(formData.get("name") ?? ""),
          slug: String(formData.get("slug") ?? ""),
          expectedIntervalSeconds: Number(formData.get("expectedIntervalSeconds") ?? 300),
          graceSeconds: Number(formData.get("graceSeconds") ?? 300),
          isEnabled: formData.get("isEnabled") === "on",
        }),
      );

      redirect("/heartbeats?status=created");
    } catch (error) {
      redirect(`/heartbeats?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function toggleHeartbeatAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageHeartbeats(actionSession.organizationContext.membership.role)) {
      redirect("/heartbeats?error=forbidden");
    }

    try {
      await updateHeartbeat(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        String(formData.get("heartbeatId") ?? ""),
        {
          isEnabled: formData.get("nextValue") === "true",
        },
      );

      redirect("/heartbeats?status=updated");
    } catch (error) {
      redirect(`/heartbeats?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function rotateHeartbeatAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageHeartbeats(actionSession.organizationContext.membership.role)) {
      redirect("/heartbeats?error=forbidden");
    }

    try {
      await rotateHeartbeatToken(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        String(formData.get("heartbeatId") ?? ""),
      );

      redirect("/heartbeats?status=rotated");
    } catch (error) {
      redirect(`/heartbeats?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function deleteHeartbeatAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageHeartbeats(actionSession.organizationContext.membership.role)) {
      redirect("/heartbeats?error=forbidden");
    }

    try {
      await deleteHeartbeat(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        String(formData.get("heartbeatId") ?? ""),
      );

      redirect("/heartbeats?status=deleted");
    } catch (error) {
      redirect(`/heartbeats?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Heartbeats
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Heartbeat monitoring</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Public token-authenticated pings for cron jobs, background workers, and integrations.
          Tokens are hashed at rest and never listed back after creation or rotation.
        </p>
      </section>

      {errorMessage ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}
      {status ? (
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Heartbeat action completed: {status}.
        </div>
      ) : null}

      {!canMutate ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-4 text-sm text-muted-foreground">
          This page is read-only for your current role.
        </div>
      ) : (
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Create heartbeat</h2>
              <p className="text-sm text-muted-foreground">
                Link each heartbeat to a heartbeat monitor. Use the API response to capture the
                one-time raw token after creation or rotation.
              </p>
            </div>
            <Link
              href="/monitors/new"
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
            >
              Create heartbeat monitor
            </Link>
          </div>

          <form action={createHeartbeatAction} className="mt-5 grid gap-4 lg:grid-cols-3">
            <label className="space-y-2 text-sm">
              <span className="font-medium">Name</span>
              <input
                name="name"
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Slug</span>
              <input
                name="slug"
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">App</span>
              <select
                name="appId"
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              >
                {apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Environment</span>
              <select
                name="environmentId"
                defaultValue=""
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="">No environment</option>
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Linked monitor</span>
              <select
                name="monitorId"
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="">Select heartbeat monitor</option>
                {heartbeatMonitors.map((monitor) => (
                  <option key={monitor.id} value={monitor.id}>
                    {monitor.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Expected interval (seconds)</span>
              <input
                name="expectedIntervalSeconds"
                type="number"
                min={30}
                defaultValue={300}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Grace period (seconds)</span>
              <input
                name="graceSeconds"
                type="number"
                min={0}
                defaultValue={300}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground lg:col-span-3">
              <input name="isEnabled" type="checkbox" defaultChecked />
              Enabled immediately
            </label>
            <div className="lg:col-span-3">
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Create heartbeat
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Configured heartbeats</h2>
            <p className="text-sm text-muted-foreground">
              Real organization state only. Tokens stay hidden after creation.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">{organization.name}</p>
        </div>

        {heartbeats.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            No heartbeats exist yet.
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/35 text-left text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-4 font-semibold">Heartbeat</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4 font-semibold">Last seen</th>
                  <th className="px-5 py-4 font-semibold">Freshness</th>
                  <th className="px-5 py-4 font-semibold">Monitor</th>
                  <th className="px-5 py-4 font-semibold">Token hint</th>
                  <th className="px-5 py-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {heartbeats.map((heartbeat) => (
                  <tr key={heartbeat.id} className="border-t border-border align-top">
                    <td className="px-5 py-4">
                      <p className="font-medium">{heartbeat.name}</p>
                      <p className="mt-1 text-muted-foreground">{heartbeat.slug}</p>
                      {heartbeat.payloadSummary ? (
                        <p className="mt-2 max-w-xs text-xs text-muted-foreground">
                          {heartbeat.payloadSummary}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 capitalize">
                      {heartbeat.isEnabled ? heartbeat.status : "disabled"}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {formatTimestamp(heartbeat.lastSeenAt)}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {heartbeat.expectedIntervalSeconds}s + {heartbeat.graceSeconds}s grace
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {heartbeat.monitorId ? (
                        <Link href={`/monitors/${heartbeat.monitorId}`} className="font-medium">
                          View monitor
                        </Link>
                      ) : (
                        "Unlinked"
                      )}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {heartbeat.tokenHint ?? "Hidden"}
                    </td>
                    <td className="px-5 py-4">
                      {!canMutate ? (
                        <span className="text-muted-foreground">Read-only</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <form action={toggleHeartbeatAction}>
                            <input type="hidden" name="heartbeatId" value={heartbeat.id} />
                            <input
                              type="hidden"
                              name="nextValue"
                              value={String(!heartbeat.isEnabled)}
                            />
                            <button
                              type="submit"
                              className="rounded-md border border-border px-3 py-2 text-xs"
                            >
                              {heartbeat.isEnabled ? "Disable" : "Enable"}
                            </button>
                          </form>
                          <form action={rotateHeartbeatAction}>
                            <input type="hidden" name="heartbeatId" value={heartbeat.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-border px-3 py-2 text-xs"
                            >
                              Rotate token
                            </button>
                          </form>
                          <form action={deleteHeartbeatAction}>
                            <input type="hidden" name="heartbeatId" value={heartbeat.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold tracking-tight">Ingestion contract</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          POST sanitized heartbeat JSON to
          {" "}
          <code className="rounded bg-muted px-2 py-1">
            {process.env.NEXT_PUBLIC_APP_URL ?? "https://prod-pulse.example.com"}/api/heartbeats/&lt;token&gt;
          </code>
          . See `docs/heartbeat-integration.md` in this repo for payload examples and rotation
          guidance.
        </p>
      </section>
    </div>
  );
}
