import Link from "next/link";
import { redirect } from "next/navigation";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import {
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";
import { requireAppSession } from "@/lib/server/auth/guards";
import { canManageAlerts } from "@/lib/server/auth/permissions";
import {
  createNotificationChannel,
  createNotificationChannelSchema,
  deleteNotificationChannel,
  listNotificationChannelsForOrganization,
  sendNotificationChannelTest,
  updateNotificationChannel,
} from "@/lib/server/alerts/notification-channel-service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AlertChannelsPage({
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
  const [channels, params] = await Promise.all([
    listNotificationChannelsForOrganization(session.user.id, organization.id),
    searchParams,
  ]);
  const errorMessage = getActionErrorMessage(
    typeof params.error === "string" ? params.error : null,
  );
  const status = typeof params.status === "string" ? params.status : null;

  async function createChannelAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageAlerts(actionSession.organizationContext.membership.role)) {
      redirect("/alerts/channels?error=forbidden");
    }

    try {
      await createNotificationChannel(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        parseSchema(createNotificationChannelSchema, {
          name: String(formData.get("name") ?? ""),
          type: "slack",
          isEnabled: formData.get("isEnabled") === "on",
          webhookUrl: String(formData.get("webhookUrl") ?? ""),
        }),
      );

      redirect("/alerts/channels?status=created");
    } catch (error) {
      redirect(`/alerts/channels?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function toggleChannelAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageAlerts(actionSession.organizationContext.membership.role)) {
      redirect("/alerts/channels?error=forbidden");
    }

    try {
      await updateNotificationChannel(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        String(formData.get("channelId") ?? ""),
        {
          isEnabled: formData.get("nextValue") === "true",
        },
      );

      redirect("/alerts/channels?status=updated");
    } catch (error) {
      redirect(`/alerts/channels?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function testChannelAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageAlerts(actionSession.organizationContext.membership.role)) {
      redirect("/alerts/channels?error=forbidden");
    }

    try {
      await sendNotificationChannelTest(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        String(formData.get("channelId") ?? ""),
      );

      redirect("/alerts/channels?status=tested");
    } catch (error) {
      redirect(`/alerts/channels?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function deleteChannelAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageAlerts(actionSession.organizationContext.membership.role)) {
      redirect("/alerts/channels?error=forbidden");
    }

    try {
      await deleteNotificationChannel(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        String(formData.get("channelId") ?? ""),
      );

      redirect("/alerts/channels?status=deleted");
    } catch (error) {
      redirect(`/alerts/channels?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Alerting
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Notification channels</h1>
        <p className="text-sm text-muted-foreground">
          Slack webhook channels only. Raw webhook URLs are never returned after creation.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/alerts/channels"
          className="rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
        >
          Channels
        </Link>
        <Link
          href="/alerts/rules"
          className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
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
          Channel action completed: {status}.
        </div>
      ) : null}

      {!canMutate ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-4 text-sm text-muted-foreground">
          This page is read-only for your current role.
        </div>
      ) : (
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold tracking-tight">Create Slack channel</h2>
          <form action={createChannelAction} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium">Label</span>
              <input
                name="name"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
                placeholder="Primary incidents"
                required
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Webhook URL</span>
              <input
                name="webhookUrl"
                type="url"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
                placeholder="https://hooks.slack.com/services/..."
                required
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input name="isEnabled" type="checkbox" defaultChecked />
              Enabled
            </label>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Create channel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Configured channels</h2>
            <p className="text-sm text-muted-foreground">
              Organization-scoped destinations only.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">{organization.name}</p>
        </div>

        {channels.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            No notification channels have been configured yet.
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {channels.map((channel) => (
              <li key={channel.id} className="rounded-md border border-border px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{channel.name}</p>
                      <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {channel.type}
                      </span>
                      <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {channel.isEnabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {channel.maskedDestination ?? "Destination masked"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Last test:{" "}
                      {channel.lastTestedAt
                        ? `${new Date(channel.lastTestedAt).toLocaleString("en-US")} (${channel.lastTestStatus ?? "unknown"})`
                        : "Never"}
                    </p>
                  </div>

                  {canMutate ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={toggleChannelAction}>
                        <input type="hidden" name="channelId" value={channel.id} />
                        <input
                          type="hidden"
                          name="nextValue"
                          value={channel.isEnabled ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-border px-3 py-2 text-sm"
                        >
                          {channel.isEnabled ? "Disable" : "Enable"}
                        </button>
                      </form>
                      <form action={testChannelAction}>
                        <input type="hidden" name="channelId" value={channel.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-border px-3 py-2 text-sm"
                        >
                          Test
                        </button>
                      </form>
                      <form action={deleteChannelAction}>
                        <input type="hidden" name="channelId" value={channel.id} />
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
