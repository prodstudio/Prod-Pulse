import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import {
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";
import { listAppsForOrganization } from "@/lib/server/apps/app-service";
import { canManageAlerts } from "@/lib/server/auth/permissions";
import { requireAppSession } from "@/lib/server/auth/guards";
import {
  ALERT_EVENT_TYPES,
  type AlertEventType,
} from "@/lib/server/alerts/alert-sanitization";
import {
  createAlertRule,
  createAlertRuleSchema,
  deleteAlertRule,
  listAlertRulesForOrganization,
  updateAlertRule,
} from "@/lib/server/alerts/alert-rule-service";
import { listNotificationChannelsForOrganization } from "@/lib/server/alerts/notification-channel-service";
import { listMonitorsForOrganization } from "@/lib/server/monitors/monitor-service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toSafeActionErrorLog(action: string, error: unknown) {
  const candidate =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
  const details = candidate?.details;
  const hint =
    typeof candidate?.hint === "string"
      ? candidate.hint
      : details &&
          typeof details === "object" &&
          details !== null &&
          "hint" in details &&
          typeof details.hint === "string"
        ? details.hint
        : undefined;

  return JSON.stringify({
    action,
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    code: typeof candidate?.code === "string" ? candidate.code : undefined,
    statusCode: typeof candidate?.status === "number" ? candidate.status : undefined,
    details: typeof details === "string" || (details && typeof details === "object") ? details : undefined,
    hint,
  });
}

export default async function AlertRulesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const organization = session.organizationContext.organization;
  const canMutate = canManageAlerts(session.organizationContext.membership.role);
  const [rules, channels, apps, monitors, params] = await Promise.all([
    listAlertRulesForOrganization(session.user.id, organization.id),
    listNotificationChannelsForOrganization(session.user.id, organization.id),
    listAppsForOrganization(organization.id),
    listMonitorsForOrganization(organization.id),
    searchParams,
  ]);
  const errorMessage = getActionErrorMessage(
    typeof params.error === "string" ? params.error : null,
  );
  const status = typeof params.status === "string" ? params.status : null;
  const requestedAppId = typeof params.appId === "string" ? params.appId : null;
  const requestedMonitorId = typeof params.monitorId === "string" ? params.monitorId : null;
  const selectedMonitor =
    requestedMonitorId && monitors.some((monitor) => monitor.id === requestedMonitorId)
      ? monitors.find((monitor) => monitor.id === requestedMonitorId) ?? null
      : null;
  const selectedAppId =
    requestedAppId && apps.some((app) => app.id === requestedAppId)
      ? requestedAppId
      : selectedMonitor?.appId ?? null;
  const defaultRuleName = selectedMonitor ? `${selectedMonitor.name} alerts` : "";

  async function createRuleAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageAlerts(actionSession.organizationContext.membership.role)) {
      redirect("/alerts/rules?error=forbidden");
    }

    let redirectTarget = "/alerts/rules?status=created";

    try {
      await createAlertRule(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        parseSchema(createAlertRuleSchema, {
          name: String(formData.get("name") ?? ""),
          appId: formData.get("appId") ? String(formData.get("appId")) : null,
          monitorId: formData.get("monitorId")
            ? String(formData.get("monitorId"))
            : null,
          isEnabled: formData.get("isEnabled") === "on",
          severityFilter: formData
            .getAll("severityFilter")
            .map((value) => String(value))
            .filter(Boolean),
          sendRecovery: formData.get("sendRecovery") === "on",
          notifyOnDegraded: formData.get("notifyOnDegraded") === "on",
          dedupeWindowSeconds: Number(formData.get("dedupeWindowSeconds") ?? 1800),
          maxRetryAttempts: Number(formData.get("maxRetryAttempts") ?? 5),
          backoffStrategy: "exponential",
          eventTypes: formData
            .getAll("eventTypes")
            .map((value) => String(value)) as AlertEventType[],
          notificationChannelIds: formData
            .getAll("notificationChannelIds")
            .map((value) => String(value)),
        }),
      );
    } catch (error) {
      console.error(toSafeActionErrorLog("alert_rule_create", error));
      unstable_rethrow(error);
      redirectTarget = `/alerts/rules?error=${getActionErrorRedirectValue(error)}`;
    }

    redirect(redirectTarget);
  }

  async function toggleRuleAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageAlerts(actionSession.organizationContext.membership.role)) {
      redirect("/alerts/rules?error=forbidden");
    }

    let redirectTarget = "/alerts/rules?status=updated";

    try {
      await updateAlertRule(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        String(formData.get("ruleId") ?? ""),
        {
          isEnabled: formData.get("nextValue") === "true",
        },
      );
    } catch (error) {
      unstable_rethrow(error);
      redirectTarget = `/alerts/rules?error=${getActionErrorRedirectValue(error)}`;
    }

    redirect(redirectTarget);
  }

  async function deleteRuleAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageAlerts(actionSession.organizationContext.membership.role)) {
      redirect("/alerts/rules?error=forbidden");
    }

    let redirectTarget = "/alerts/rules?status=deleted";

    try {
      await deleteAlertRule(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        String(formData.get("ruleId") ?? ""),
      );
    } catch (error) {
      unstable_rethrow(error);
      redirectTarget = `/alerts/rules?error=${getActionErrorRedirectValue(error)}`;
    }

    redirect(redirectTarget);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Alerting
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Alert rules</h1>
        <p className="text-sm text-muted-foreground">
          Incident-event routing only. Rules queue deliveries; the cron runner sends them.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/alerts/channels"
          className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
        >
          Channels
        </Link>
        <Link
          href="/alerts/rules"
          className="rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
        >
          Rules
        </Link>
      </div>

      {errorMessage ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}
      {status ? (
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Rule action completed: {status}.
        </div>
      ) : null}

      {!canMutate ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-4 text-sm text-muted-foreground">
          This page is read-only for your current role.
        </div>
      ) : (
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold tracking-tight">Create incident alert rule</h2>
          <form action={createRuleAction} className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium">Rule name</span>
              <input
                name="name"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
                placeholder="Primary incident notifications"
                defaultValue={defaultRuleName}
                required
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">App scope</span>
              <select
                name="appId"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
                defaultValue={selectedAppId ?? ""}
              >
                <option value="">All apps</option>
                {apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Monitor scope</span>
              <select
                name="monitorId"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
                defaultValue={selectedMonitor?.id ?? ""}
              >
                <option value="">All monitors</option>
                {monitors.map((monitor) => (
                  <option key={monitor.id} value={monitor.id}>
                    {monitor.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Dedupe window (seconds)</span>
              <input
                name="dedupeWindowSeconds"
                type="number"
                min={0}
                defaultValue={1800}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Max retries</span>
              <input
                name="maxRetryAttempts"
                type="number"
                min={0}
                defaultValue={5}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <div className="space-y-2 text-sm">
              <span className="font-medium">Event types</span>
              <div className="grid gap-2 md:grid-cols-2">
                {ALERT_EVENT_TYPES.map((eventType) => (
                  <label key={eventType} className="flex items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      name="eventTypes"
                      value={eventType}
                      defaultChecked={eventType !== "incident_updated"}
                    />
                    {eventType}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <span className="font-medium">Channels</span>
              <div className="grid gap-2">
                {channels.length === 0 ? (
                  <p className="text-muted-foreground">
                    Create a Slack channel first.
                  </p>
                ) : (
                  channels.map((channel) => (
                    <label key={channel.id} className="flex items-center gap-2 text-muted-foreground">
                      <input
                        type="checkbox"
                        name="notificationChannelIds"
                        value={channel.id}
                        defaultChecked={channel.isEnabled}
                      />
                      {channel.name}{" "}
                      <span className="text-xs text-muted-foreground/80">
                        ({channel.maskedDestination ?? "masked"})
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <span className="font-medium">Severity filter</span>
              <div className="grid gap-2 md:grid-cols-2">
                {["warning", "critical", "emergency"].map((severity) => (
                  <label key={severity} className="flex items-center gap-2 text-muted-foreground">
                    <input type="checkbox" name="severityFilter" value={severity} />
                    {severity}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <span className="font-medium">Behavior</span>
              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-muted-foreground">
                  <input name="isEnabled" type="checkbox" defaultChecked />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-muted-foreground">
                  <input name="sendRecovery" type="checkbox" defaultChecked />
                  Send recovery alerts
                </label>
                <label className="flex items-center gap-2 text-muted-foreground">
                  <input name="notifyOnDegraded" type="checkbox" defaultChecked />
                  Notify on degraded incidents
                </label>
              </div>
            </div>
            <div className="lg:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                disabled={channels.length === 0}
              >
                Create rule
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Configured rules</h2>
            <p className="text-sm text-muted-foreground">
              Persisted rule state only.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">{organization.name}</p>
        </div>

        {rules.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            No alert rules have been configured yet.
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {rules.map((rule) => (
              <li key={rule.id} className="rounded-md border border-border px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{rule.name}</p>
                      <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {rule.isEnabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Events: {rule.eventTypes.join(", ")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Channels:{" "}
                      {rule.notificationChannelIds.length > 0
                        ? rule.notificationChannelIds.length
                        : "0"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Scope: {rule.appId ? "app-scoped" : "organization"}{" "}
                      {rule.monitorId ? "· monitor-scoped" : ""}
                    </p>
                  </div>

                  {canMutate ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={toggleRuleAction}>
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input
                          type="hidden"
                          name="nextValue"
                          value={rule.isEnabled ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-border px-3 py-2 text-sm"
                        >
                          {rule.isEnabled ? "Disable" : "Enable"}
                        </button>
                      </form>
                      <form action={deleteRuleAction}>
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
