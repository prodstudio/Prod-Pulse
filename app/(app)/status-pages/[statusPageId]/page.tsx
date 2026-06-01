import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import {
  ApiError,
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";
import { listAppsForOrganization } from "@/lib/server/apps/app-service";
import { listEnvironmentsForApp } from "@/lib/server/apps/environment-service";
import { requireAppSession } from "@/lib/server/auth/guards";
import { canManageStatusPages } from "@/lib/server/auth/permissions";
import { listMonitorsForOrganization } from "@/lib/server/monitors/monitor-service";
import {
  createStatusPageComponent,
  createStatusPageComponentSchema,
  deleteStatusPage,
  deleteStatusPageComponent,
  getStatusPageById,
  getStatusPagePreview,
  updateStatusPage,
  updateStatusPageComponent,
  updateStatusPageComponentSchema,
  updateStatusPageSchema,
} from "@/lib/server/status-pages/status-page-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    statusPageId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "major_outage":
      return "bg-red-500/15 text-red-700 border-red-500/30";
    case "partial_outage":
      return "bg-amber-500/15 text-amber-700 border-amber-500/30";
    case "degraded":
      return "bg-yellow-500/15 text-yellow-700 border-yellow-500/30";
    case "maintenance":
      return "bg-blue-500/15 text-blue-700 border-blue-500/30";
    case "operational":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export default async function StatusPageDetailPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const { statusPageId } = await params;
  const organization = session.organizationContext.organization;
  const canMutate = canManageStatusPages(session.organizationContext.membership.role);
  const [statusPageResult, preview, monitors, apps, queryParams] = await Promise.all([
    getStatusPageById(
      session.user.id,
      statusPageId,
      organization.id,
    ).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }

      throw error;
    }),
    getStatusPagePreview(
      session.user.id,
      statusPageId,
      organization.id,
    ).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }

      throw error;
    }),
    listMonitorsForOrganization(organization.id),
    listAppsForOrganization(organization.id),
    searchParams,
  ]);

  if (!statusPageResult || !preview) {
    notFound();
  }

  const environments = (
    await Promise.all(
      apps.map((app) => listEnvironmentsForApp(organization.id, app.id)),
    )
  ).flat();

  const errorMessage = getActionErrorMessage(
    typeof queryParams.error === "string" ? queryParams.error : null,
  );
  const status = typeof queryParams.status === "string" ? queryParams.status : null;

  async function updatePageAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/status-pages");
    }

    if (!canManageStatusPages(actionSession.organizationContext.membership.role)) {
      redirect(`/status-pages/${statusPageId}?error=forbidden`);
    }

    try {
      await updateStatusPage(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        statusPageId,
        parseSchema(updateStatusPageSchema, {
          name: String(formData.get("name") ?? ""),
          slug: String(formData.get("slug") ?? ""),
          description: formData.get("description")
            ? String(formData.get("description"))
            : null,
          isPublic: formData.get("isPublic") === "on",
        }),
      );

      revalidatePath(`/status-pages/${statusPageId}`);
      redirect(`/status-pages/${statusPageId}?status=updated`);
    } catch (error) {
      redirect(`/status-pages/${statusPageId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function deletePageAction() {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/status-pages");
    }

    if (!canManageStatusPages(actionSession.organizationContext.membership.role)) {
      redirect(`/status-pages/${statusPageId}?error=forbidden`);
    }

    try {
      await deleteStatusPage(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        statusPageId,
      );

      revalidatePath("/status-pages");
      redirect("/status-pages?status=deleted");
    } catch (error) {
      redirect(`/status-pages/${statusPageId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function createComponentAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/status-pages");
    }

    if (!canManageStatusPages(actionSession.organizationContext.membership.role)) {
      redirect(`/status-pages/${statusPageId}?error=forbidden`);
    }

    try {
      await createStatusPageComponent(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        statusPageId,
        parseSchema(createStatusPageComponentSchema, {
          monitoredAppId: formData.get("monitoredAppId")
            ? String(formData.get("monitoredAppId"))
            : null,
          environmentId: formData.get("environmentId")
            ? String(formData.get("environmentId"))
            : null,
          monitorId: formData.get("monitorId")
            ? String(formData.get("monitorId"))
            : null,
          displayName: String(formData.get("displayName") ?? ""),
          sortOrder: Number(formData.get("sortOrder") ?? 0),
          isVisible: formData.get("isVisible") === "on",
        }),
      );

      revalidatePath(`/status-pages/${statusPageId}`);
      redirect(`/status-pages/${statusPageId}?status=component-created`);
    } catch (error) {
      redirect(`/status-pages/${statusPageId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function updateComponentAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/status-pages");
    }

    if (!canManageStatusPages(actionSession.organizationContext.membership.role)) {
      redirect(`/status-pages/${statusPageId}?error=forbidden`);
    }

    try {
      await updateStatusPageComponent(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        statusPageId,
        String(formData.get("componentId") ?? ""),
        parseSchema(updateStatusPageComponentSchema, {
          displayName: String(formData.get("displayName") ?? ""),
          sortOrder: Number(formData.get("sortOrder") ?? 0),
          isVisible: formData.get("isVisible") === "on",
        }),
      );

      revalidatePath(`/status-pages/${statusPageId}`);
      redirect(`/status-pages/${statusPageId}?status=component-updated`);
    } catch (error) {
      redirect(`/status-pages/${statusPageId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function deleteComponentAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/status-pages");
    }

    if (!canManageStatusPages(actionSession.organizationContext.membership.role)) {
      redirect(`/status-pages/${statusPageId}?error=forbidden`);
    }

    try {
      await deleteStatusPageComponent(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        statusPageId,
        String(formData.get("componentId") ?? ""),
      );

      revalidatePath(`/status-pages/${statusPageId}`);
      redirect(`/status-pages/${statusPageId}?status=component-deleted`);
    } catch (error) {
      redirect(`/status-pages/${statusPageId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Internal preview
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">{statusPageResult.page.name}</h1>
          </div>
          <Link
            href="/status-pages"
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
          >
            Back to pages
          </Link>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Authenticated internal-only preview. No public status route or custom domain exists in
          this phase.
        </p>
      </section>

      {errorMessage ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}
      {status ? (
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Status page action completed: {status}.
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Page metadata</h2>
              <p className="text-sm text-muted-foreground">
                Manage the internal preview definition for this organization.
              </p>
            </div>
            {canMutate ? (
              <form action={deletePageAction}>
                <button
                  type="submit"
                  className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive"
                >
                  Delete page
                </button>
              </form>
            ) : null}
          </div>

          {canMutate ? (
            <form action={updatePageAction} className="mt-5 grid gap-4">
              <label className="space-y-2 text-sm">
                <span className="font-medium">Name</span>
                <input
                  name="name"
                  defaultValue={statusPageResult.page.name}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium">Slug</span>
                <input
                  name="slug"
                  defaultValue={statusPageResult.page.slug}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium">Description</span>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={statusPageResult.page.description ?? ""}
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="isPublic"
                  defaultChecked={statusPageResult.page.isPublic}
                  className="size-4"
                />
                <span>Preserve the reserved public flag value without publishing anything.</span>
              </label>
              <div>
                <button
                  type="submit"
                  className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
                >
                  Save status page
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-5 space-y-3 text-sm">
              <p><span className="font-medium">Slug:</span> {statusPageResult.page.slug}</p>
              <p><span className="font-medium">Description:</span> {statusPageResult.page.description ?? "None"}</p>
              <p><span className="font-medium">Reserved public flag:</span> {statusPageResult.page.isPublic ? "Set" : "Unset"}</p>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Preview summary
          </p>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">{preview.page.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Overall status derived from persisted monitor results, active incidents, and live
                maintenance windows.
              </p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusBadgeClass(preview.overallStatus)}`}>
              {preview.overallStatus.replaceAll("_", " ")}
            </span>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-md border border-border px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Components</p>
              <p className="mt-2 text-sm">{preview.components.length}</p>
            </div>
            <div className="rounded-md border border-border px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Active incidents</p>
              <p className="mt-2 text-sm">{preview.incidents.length}</p>
            </div>
            <div className="rounded-md border border-border px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Latest evidence</p>
              <p className="mt-2 text-sm">{formatTimestamp(preview.latestCheckedAt)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold tracking-tight">Add component mapping</h2>
          <p className="text-sm text-muted-foreground">
            Components stay lightweight. Operational state is derived live from apps,
            environments, monitors, incidents, maintenance windows, and heartbeat-backed monitor
            results.
          </p>

          {canMutate ? (
            <form action={createComponentAction} className="mt-5 grid gap-4">
              <label className="space-y-2 text-sm">
                <span className="font-medium">Display name</span>
                <input
                  name="displayName"
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium">App</span>
                <select
                  name="monitoredAppId"
                  defaultValue=""
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  <option value="">Optional app mapping</option>
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
                  <option value="">Optional environment mapping</option>
                  {environments.map((environment) => (
                    <option key={environment.id} value={environment.id}>
                      {environment.name} ({environment.type})
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium">Monitor</span>
                <select
                  name="monitorId"
                  defaultValue=""
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  <option value="">Optional monitor mapping</option>
                  {monitors.map((monitor) => (
                    <option key={monitor.id} value={monitor.id}>
                      {monitor.name} ({monitor.type})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Display order</span>
                  <input
                    type="number"
                    name="sortOrder"
                    min={0}
                    defaultValue={0}
                    className="w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <label className="flex items-center gap-3 text-sm pt-7">
                  <input type="checkbox" name="isVisible" defaultChecked className="size-4" />
                  <span>Visible in preview</span>
                </label>
              </div>
              <div>
                <button
                  type="submit"
                  className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
                >
                  Add component
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-5 rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              This mapping surface is read-only for your current role.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold tracking-tight">Component mappings</h2>
          {statusPageResult.components.length === 0 ? (
            <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              No components mapped yet.
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {statusPageResult.components.map((component) => (
                <div key={component.id} className="rounded-md border border-border p-4">
                  {canMutate ? (
                    <div className="grid gap-3">
                      <form
                        action={updateComponentAction}
                        className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr_0.7fr_auto] lg:items-end"
                      >
                        <input type="hidden" name="componentId" value={component.id} />
                        <label className="space-y-2 text-sm">
                          <span className="font-medium">Display name</span>
                          <input
                            name="displayName"
                            defaultValue={component.displayName}
                            required
                            className="w-full rounded-md border border-input bg-background px-3 py-2"
                          />
                        </label>
                        <label className="space-y-2 text-sm">
                          <span className="font-medium">Display order</span>
                          <input
                            type="number"
                            name="sortOrder"
                            min={0}
                            defaultValue={component.sortOrder}
                            className="w-full rounded-md border border-input bg-background px-3 py-2"
                          />
                        </label>
                        <label className="flex items-center gap-3 text-sm pb-2">
                          <input
                            type="checkbox"
                            name="isVisible"
                            defaultChecked={component.isVisible}
                            className="size-4"
                          />
                          <span>Visible</span>
                        </label>
                        <button
                          type="submit"
                          className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
                        >
                          Save
                        </button>
                      </form>
                      <form action={deleteComponentAction}>
                        <input type="hidden" name="componentId" value={component.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive"
                        >
                          Delete component
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="font-medium">{component.displayName}</p>
                      <p className="text-sm text-muted-foreground">
                        sort {component.sortOrder} · {component.isVisible ? "visible" : "hidden"}
                      </p>
                    </div>
                  )}
                  <p className="mt-3 text-sm text-muted-foreground">
                    app {component.monitoredAppId ?? "none"} · environment {component.environmentId ?? "none"} · monitor {component.monitorId ?? "none"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Internal preview
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">Operational preview</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Derived live from persisted backend state only. No public route exists in this phase.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusBadgeClass(preview.overallStatus)}`}>
            {preview.overallStatus.replaceAll("_", " ")}
          </span>
        </div>

        {preview.incidents.length > 0 ? (
          <div className="mt-5 rounded-md border border-border bg-background p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Affecting incidents
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {preview.incidents.map((incident) => (
                <Link
                  key={incident.id}
                  href={`/incidents/${incident.id}`}
                  className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
                >
                  {incident.title} · {incident.severity}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {preview.components.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
              No visible components are mapped to this preview.
            </div>
          ) : (
            preview.components.map((component) => (
              <div key={component.id} className="rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{component.displayName}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {component.monitorName ?? component.environmentName ?? component.appName ?? "Unmapped target"}
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusBadgeClass(component.status)}`}>
                    {component.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-md border border-border px-3 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Evidence</p>
                    <p className="mt-2 text-muted-foreground">{component.statusReason ?? "No direct evidence available yet."}</p>
                  </div>
                  <div className="rounded-md border border-border px-3 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Latest check</p>
                    <p className="mt-2 text-muted-foreground">{formatTimestamp(component.latestCheckAt)}</p>
                  </div>
                  <div className="rounded-md border border-border px-3 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Maintenance</p>
                    <p className="mt-2 text-muted-foreground">{component.maintenanceTitle ?? "None active"}</p>
                  </div>
                  <div className="rounded-md border border-border px-3 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Heartbeat</p>
                    <p className="mt-2 text-muted-foreground">{component.lastSeenAt ? formatTimestamp(component.lastSeenAt) : "Not applicable"}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3 text-sm">
                  {component.evidence.monitorId ? (
                    <Link
                      href={`/monitors/${component.evidence.monitorId}`}
                      className="rounded-md border border-border px-3 py-2 text-muted-foreground"
                    >
                      Monitor
                    </Link>
                  ) : null}
                  {component.evidence.incidentId ? (
                    <Link
                      href={`/incidents/${component.evidence.incidentId}`}
                      className="rounded-md border border-border px-3 py-2 text-muted-foreground"
                    >
                      Incident
                    </Link>
                  ) : null}
                  {component.appSlug ? (
                    <Link
                      href={`/apps/${component.evidence.appId}`}
                      className="rounded-md border border-border px-3 py-2 text-muted-foreground"
                    >
                      App
                    </Link>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
