import { redirect, unstable_rethrow } from "next/navigation";

import { NewMonitorForm } from "@/components/monitors/new-monitor-form";
import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { createMonitor, createMonitorSchema } from "@/lib/server/monitors/monitor-service";
import { listAppsForOrganization } from "@/lib/server/apps/app-service";
import { listEnvironmentsForApp } from "@/lib/server/apps/environment-service";
import {
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { requireAppSession } from "@/lib/server/auth/guards";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";
import { parseSchema } from "@/lib/server/api/validation";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewMonitorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  if (!canManageOperationalConfig(session.organizationContext.membership.role)) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-sm text-muted-foreground">
        This page requires admin or owner access.
      </div>
    );
  }

  const params = await searchParams;
  const errorMessage = getActionErrorMessage(
    typeof params.error === "string" ? params.error : null,
  );
  const selectedAppId = typeof params.appId === "string" ? params.appId : null;
  const selectedEnvironmentId =
    typeof params.environmentId === "string" ? params.environmentId : null;

  const apps = await listAppsForOrganization(session.organizationContext.organization.id);
  const environmentsByApp = await Promise.all(
    apps.map(async (app) => ({
      appId: app.id,
      environments: await listEnvironmentsForApp(
        session.organizationContext!.organization.id,
        app.id,
      ),
    })),
  );
  const environmentOptions = environmentsByApp.flatMap((entry) =>
    entry.environments.map((environment) => ({
      id: environment.id,
      appId: entry.appId,
      name: environment.name,
    })),
  );
  const validInitialAppId = apps.some((app) => app.id === selectedAppId) ? selectedAppId : null;
  const validInitialEnvironmentId = environmentOptions.some(
    (environment) =>
      environment.id === selectedEnvironmentId &&
      (!validInitialAppId || environment.appId === validInitialAppId),
  )
    ? selectedEnvironmentId
    : null;

  async function createMonitorAction(formData: FormData) {
    "use server";

    const sessionForAction = await requireAppSession();

    if (!sessionForAction.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageOperationalConfig(sessionForAction.organizationContext.membership.role)) {
      redirect("/monitors/new?error=Admin%20or%20owner%20access%20is%20required.");
    }

    let redirectTarget = "/alerts/rules?status=monitor_created";

    try {
      const input = parseSchema(createMonitorSchema, {
        appId: String(formData.get("appId") ?? ""),
        environmentId: formData.get("environmentId")
          ? String(formData.get("environmentId"))
          : null,
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
        type: String(formData.get("type") ?? ""),
        description: formData.get("description")
          ? String(formData.get("description"))
          : null,
        status: String(formData.get("status") ?? "unknown"),
        isEnabled: formData.get("isEnabled") === "on",
        requestMethod: String(formData.get("requestMethod") ?? "GET"),
        targetUrl: formData.get("targetUrl") ? String(formData.get("targetUrl")) : null,
        timeoutMs: Number(formData.get("timeoutMs") ?? 10000),
        intervalSeconds: Number(formData.get("intervalSeconds") ?? 300),
        latencyThresholdMs: formData.get("latencyThresholdMs")
          ? Number(formData.get("latencyThresholdMs"))
          : null,
        consecutiveFailureThreshold: Number(
          formData.get("consecutiveFailureThreshold") ?? 3,
        ),
        consecutiveRecoveryThreshold: Number(
          formData.get("consecutiveRecoveryThreshold") ?? 2,
        ),
      });

      const monitor = await createMonitor(
        {
          userId: sessionForAction.user.id,
          organization: sessionForAction.organizationContext.organization,
          membership: sessionForAction.organizationContext.membership,
        },
        input,
      );
      redirectTarget = `/alerts/rules?status=monitor_created&appId=${encodeURIComponent(
        input.appId,
      )}&monitorId=${encodeURIComponent(monitor.id)}`;
    } catch (error) {
      unstable_rethrow(error);
      const errorCode = getActionErrorRedirectValue(error);
      redirect(`/monitors/new?error=${errorCode}`);
    }

    redirect(redirectTarget);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Monitor setup
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Create monitor</h1>
        <p className="text-sm text-muted-foreground">
          The form stores persisted monitor definitions only. No check execution runs in
          this phase.
        </p>
      </div>

      {apps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-sm text-muted-foreground">
          Create at least one monitored app before adding monitors.
        </div>
      ) : (
        <NewMonitorForm
          action={createMonitorAction}
          apps={apps.map((app) => ({ id: app.id, name: app.name }))}
          environments={environmentOptions}
          errorMessage={errorMessage}
          initialAppId={validInitialAppId}
          initialEnvironmentId={validInitialEnvironmentId}
        />
      )}
    </div>
  );
}
