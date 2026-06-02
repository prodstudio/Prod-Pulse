import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { NoOrganizationState } from "@/components/layout/no-organization-state";
import {
  ApiError,
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";
import { requireAppSession, requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageIncidents } from "@/lib/server/auth/permissions";
import {
  createAndLinkExternalIssueReference,
  createExternalIssueReferenceSchema,
  unlinkExternalIssueFromIncident,
  updateIncidentCustomerImpact,
  updateIncidentCustomerImpactSchema,
} from "@/lib/server/external-issues/external-issue-service";
import {
  createIncidentUpdateSchema,
  createUserIncidentUpdate,
  getIncidentById,
  resolveIncident,
  resolveIncidentSchema,
  acknowledgeIncident,
} from "@/lib/server/incidents/incident-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    incidentId: string;
  }>;
  searchParams: Promise<{
    error?: string;
    status?: string;
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

  return hours === 0 ? `${minutes}m` : remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

export default async function IncidentDetailPage({ params, searchParams }: PageProps) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const { incidentId } = await params;
  const [incident, statusParams] = await Promise.all([
    getIncidentById(
      session.user.id,
      incidentId,
      session.organizationContext.organization.id,
    ).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }

      throw error;
    }),
    searchParams,
  ]);

  if (!incident) {
    notFound();
  }

  const canMutate = canManageIncidents(session.organizationContext.membership.role);
  const actionError = getActionErrorMessage(statusParams.error);

  async function acknowledgeAction() {
    "use server";

    try {
      const user = await requireUser();
      const organizationContext = await requireOrgMembership(user.id);

      if (!canManageIncidents(organizationContext.membership.role)) {
        throw new ApiError(
          403,
          "ORG_ROLE_REQUIRED",
          "This action requires responder, admin, or owner access.",
        );
      }

      await acknowledgeIncident(
        {
          userId: user.id,
          organization: organizationContext.organization,
          membership: organizationContext.membership,
        },
        incidentId,
      );

      revalidatePath("/dashboard");
      revalidatePath("/incidents");
      revalidatePath(`/incidents/${incidentId}`);
      redirect(`/incidents/${incidentId}?status=acknowledged`);
    } catch (error) {
      redirect(`/incidents/${incidentId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function addUpdateAction(formData: FormData) {
    "use server";

    try {
      const user = await requireUser();
      const organizationContext = await requireOrgMembership(user.id);

      if (!canManageIncidents(organizationContext.membership.role)) {
        throw new ApiError(
          403,
          "ORG_ROLE_REQUIRED",
          "This action requires responder, admin, or owner access.",
        );
      }

      const input = parseSchema(createIncidentUpdateSchema, {
        message: formData.get("message") ? String(formData.get("message")) : null,
        statusTo: formData.get("statusTo") ? String(formData.get("statusTo")) : undefined,
        rootCause: formData.get("rootCause") ? String(formData.get("rootCause")) : null,
        resolutionNotes: formData.get("resolutionNotes")
          ? String(formData.get("resolutionNotes"))
          : null,
      });

      await createUserIncidentUpdate(
        {
          userId: user.id,
          organization: organizationContext.organization,
          membership: organizationContext.membership,
        },
        incidentId,
        input,
      );

      revalidatePath("/dashboard");
      revalidatePath("/incidents");
      revalidatePath(`/incidents/${incidentId}`);
      redirect(`/incidents/${incidentId}?status=updated`);
    } catch (error) {
      redirect(`/incidents/${incidentId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function resolveAction(formData: FormData) {
    "use server";

    try {
      const user = await requireUser();
      const organizationContext = await requireOrgMembership(user.id);

      if (!canManageIncidents(organizationContext.membership.role)) {
        throw new ApiError(
          403,
          "ORG_ROLE_REQUIRED",
          "This action requires responder, admin, or owner access.",
        );
      }

      const input = parseSchema(resolveIncidentSchema, {
        message: formData.get("message") ? String(formData.get("message")) : null,
        rootCause: formData.get("rootCause") ? String(formData.get("rootCause")) : null,
        resolutionNotes: formData.get("resolutionNotes")
          ? String(formData.get("resolutionNotes"))
          : null,
      });

      await resolveIncident(
        {
          userId: user.id,
          organization: organizationContext.organization,
          membership: organizationContext.membership,
        },
        incidentId,
        input,
      );

      revalidatePath("/dashboard");
      revalidatePath("/incidents");
      revalidatePath(`/incidents/${incidentId}`);
      redirect(`/incidents/${incidentId}?status=resolved`);
    } catch (error) {
      redirect(`/incidents/${incidentId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function linkExternalIssueAction(formData: FormData) {
    "use server";

    try {
      const user = await requireUser();
      const organizationContext = await requireOrgMembership(user.id);

      if (!canManageIncidents(organizationContext.membership.role)) {
        throw new ApiError(
          403,
          "ORG_ROLE_REQUIRED",
          "This action requires responder, admin, or owner access.",
        );
      }

      const input = parseSchema(createExternalIssueReferenceSchema, {
        sourceKind: formData.get("sourceKind") ? String(formData.get("sourceKind")) : "ciex",
        externalId: formData.get("externalId") ? String(formData.get("externalId")) : "",
        externalKey: formData.get("externalKey") ? String(formData.get("externalKey")) : null,
        title: formData.get("title") ? String(formData.get("title")) : "",
        status: formData.get("status") ? String(formData.get("status")) : null,
        priority: formData.get("priority") ? String(formData.get("priority")) : null,
        sourceUrl: formData.get("sourceUrl") ? String(formData.get("sourceUrl")) : null,
        customerReference: formData.get("customerReference")
          ? String(formData.get("customerReference"))
          : null,
        summary: formData.get("summary") ? String(formData.get("summary")) : null,
      });

      await createAndLinkExternalIssueReference(
        {
          userId: user.id,
          organization: organizationContext.organization,
          membership: organizationContext.membership,
        },
        incidentId,
        input,
      );

      revalidatePath("/incidents");
      revalidatePath(`/incidents/${incidentId}`);
      redirect(`/incidents/${incidentId}?status=external_issue_linked`);
    } catch (error) {
      redirect(`/incidents/${incidentId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function unlinkExternalIssueAction(formData: FormData) {
    "use server";

    try {
      const user = await requireUser();
      const organizationContext = await requireOrgMembership(user.id);

      if (!canManageIncidents(organizationContext.membership.role)) {
        throw new ApiError(
          403,
          "ORG_ROLE_REQUIRED",
          "This action requires responder, admin, or owner access.",
        );
      }

      const externalIssueId = formData.get("externalIssueId");

      if (!externalIssueId) {
        throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed.");
      }

      await unlinkExternalIssueFromIncident(
        {
          userId: user.id,
          organization: organizationContext.organization,
          membership: organizationContext.membership,
        },
        incidentId,
        String(externalIssueId),
      );

      revalidatePath("/incidents");
      revalidatePath(`/incidents/${incidentId}`);
      redirect(`/incidents/${incidentId}?status=external_issue_unlinked`);
    } catch (error) {
      redirect(`/incidents/${incidentId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function updateCustomerImpactAction(formData: FormData) {
    "use server";

    try {
      const user = await requireUser();
      const organizationContext = await requireOrgMembership(user.id);

      if (!canManageIncidents(organizationContext.membership.role)) {
        throw new ApiError(
          403,
          "ORG_ROLE_REQUIRED",
          "This action requires responder, admin, or owner access.",
        );
      }

      const input = parseSchema(updateIncidentCustomerImpactSchema, {
        customerImpactSummary: formData.get("customerImpactSummary")
          ? String(formData.get("customerImpactSummary"))
          : null,
        customerImpactNotes: formData.get("customerImpactNotes")
          ? String(formData.get("customerImpactNotes"))
          : null,
      });

      await updateIncidentCustomerImpact(
        {
          userId: user.id,
          organization: organizationContext.organization,
          membership: organizationContext.membership,
        },
        incidentId,
        input,
      );

      revalidatePath("/incidents");
      revalidatePath(`/incidents/${incidentId}`);
      redirect(`/incidents/${incidentId}?status=customer_impact_updated`);
    } catch (error) {
      redirect(`/incidents/${incidentId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Incident detail
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{incident.title}</h1>
        <p className="text-sm text-muted-foreground">
          {incident.severity} · {incident.status} · {incident.appName ?? "Unknown app"} ·{" "}
          {incident.monitorName ?? "Unknown monitor"}
        </p>
        {incident.summary ? (
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{incident.summary}</p>
        ) : null}
        {statusParams.status ? (
          <p className="text-sm text-emerald-600">
            Incident action completed: {statusParams.status}.
          </p>
        ) : null}
        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ConfigRow label="Status" value={incident.status} />
        <ConfigRow label="Severity" value={incident.severity} />
        <ConfigRow label="Detected" value={formatTimestamp(incident.detectedAt)} />
        <ConfigRow label="Duration" value={formatDuration(incident.durationSeconds)} />
        <ConfigRow label="Opened" value={incident.openedAt ? formatTimestamp(incident.openedAt) : "Not opened"} />
        <ConfigRow
          label="Acknowledged"
          value={incident.acknowledgedAt ? formatTimestamp(incident.acknowledgedAt) : "Not acknowledged"}
        />
        <ConfigRow
          label="Recovered"
          value={incident.recoveredAt ? formatTimestamp(incident.recoveredAt) : "No recovery yet"}
        />
        <ConfigRow
          label="Resolved"
          value={incident.resolvedAt ? formatTimestamp(incident.resolvedAt) : "Still active"}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Incident context</h2>
            <div className="mt-5 grid gap-3">
              <ConfigRow label="App" value={incident.appName ?? incident.appId} />
              <ConfigRow label="Monitor" value={incident.monitorName ?? incident.monitorId} />
              <ConfigRow
                label="Environment"
                value={incident.environmentName ?? incident.environmentId ?? "App-level incident"}
              />
              <ConfigRow
                label="Auto resolve"
                value={incident.autoResolveOnRecovery ? "Enabled" : "Disabled"}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Root cause and resolution</h2>
            <div className="mt-5 space-y-4 text-sm leading-6 text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">Root cause</p>
                <p>{incident.rootCause ?? "No root cause recorded yet."}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Resolution notes</p>
                <p>{incident.resolutionNotes ?? "No resolution notes recorded yet."}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Customer impact</h2>
            <div className="mt-5 space-y-4 text-sm leading-6 text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">Impact summary</p>
                <p>{incident.customerImpactSummary ?? "No customer impact summary recorded yet."}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Impact notes</p>
                <p>{incident.customerImpactNotes ?? "No customer impact notes recorded yet."}</p>
              </div>
            </div>
            {canMutate && incident.status !== "resolved" ? (
              <form action={updateCustomerImpactAction} className="mt-5 space-y-4">
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Impact summary</span>
                  <textarea
                    name="customerImpactSummary"
                    rows={3}
                    defaultValue={incident.customerImpactSummary ?? ""}
                    className="w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Impact notes</span>
                  <textarea
                    name="customerImpactNotes"
                    rows={4}
                    defaultValue={incident.customerImpactNotes ?? ""}
                    className="w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <Button type="submit" variant="secondary">
                  Save customer impact
                </Button>
              </form>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Linked external issues</h2>
            {incident.linkedExternalIssues.length === 0 ? (
              <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                No external issues are linked to this incident yet.
              </div>
            ) : (
              <ul className="mt-6 space-y-3">
                {incident.linkedExternalIssues.map((issue) => (
                  <li key={issue.id} className="rounded-md border border-border px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">
                          {issue.externalKey ?? issue.externalId} · {issue.title}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {issue.sourceKind}
                          {issue.status ? ` · ${issue.status}` : ""}
                          {issue.priority ? ` · ${issue.priority}` : ""}
                        </p>
                      </div>
                      {canMutate ? (
                        <form action={unlinkExternalIssueAction}>
                          <input type="hidden" name="externalIssueId" value={issue.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Unlink
                          </Button>
                        </form>
                      ) : null}
                    </div>
                    {issue.customerReference ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Customer reference: {issue.customerReference}
                      </p>
                    ) : null}
                    {issue.summary ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{issue.summary}</p>
                    ) : null}
                    {issue.sourceUrl ? (
                      <a
                        href={issue.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
                      >
                        Open source ticket
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canMutate && incident.status !== "resolved" ? (
              <form action={linkExternalIssueAction} className="mt-6 space-y-4 border-t border-border pt-6">
                <input type="hidden" name="sourceKind" value="ciex" />
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">CIEX ticket id</span>
                    <input
                      name="externalId"
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Ticket key</span>
                    <input
                      name="externalKey"
                      placeholder="CIEX-1234"
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="font-medium">Title</span>
                    <input
                      name="title"
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Status</span>
                    <input
                      name="status"
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Priority</span>
                    <input
                      name="priority"
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Customer reference</span>
                    <input
                      name="customerReference"
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Source URL</span>
                    <input
                      name="sourceUrl"
                      type="url"
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                </div>
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Safe summary</span>
                  <textarea
                    name="summary"
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <Button type="submit" variant="secondary">
                  Link CIEX ticket
                </Button>
              </form>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Latest related results</h2>
            {incident.latestResults.length === 0 ? (
              <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                No persisted results are linked yet.
              </div>
            ) : (
              <ul className="mt-6 space-y-3">
                {incident.latestResults.map((result) => (
                  <li key={result.id} className="rounded-md border border-border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium capitalize">{result.status}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatTimestamp(result.checkedAt)}
                      </p>
                    </div>
                    {result.errorSummary ? (
                      <p className="mt-2 text-sm text-destructive">{result.errorSummary}</p>
                    ) : null}
                    {result.metadataSummary ? (
                      <p className="mt-2 text-sm text-muted-foreground">{result.metadataSummary}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Timeline</h2>
            {incident.updates.length === 0 ? (
              <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                No incident updates have been recorded yet.
              </div>
            ) : (
              <ol className="mt-6 space-y-3">
                {incident.updates.map((update) => (
                  <li key={update.id} className="rounded-md border border-border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium capitalize">
                        {update.statusFrom && update.statusTo
                          ? `${update.statusFrom} -> ${update.statusTo}`
                          : update.statusTo ?? update.actorType}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatTimestamp(update.createdAt)}
                      </p>
                    </div>
                    {update.message ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {update.message}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Actions</h2>
            {!canMutate ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Responder, admin, or owner access is required to update incidents.
              </p>
            ) : incident.status === "resolved" ? (
              <p className="mt-4 text-sm text-muted-foreground">
                This incident is resolved and read-only in this phase.
              </p>
            ) : (
              <div className="mt-4 space-y-6">
                {["detected", "open"].includes(incident.status) ? (
                  <form action={acknowledgeAction}>
                    <Button type="submit">Acknowledge incident</Button>
                  </form>
                ) : null}

                <form action={addUpdateAction} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2 text-sm">
                      <span className="font-medium">Status transition</span>
                      <select
                        name="statusTo"
                        defaultValue=""
                        className="w-full rounded-md border border-input bg-background px-3 py-2"
                      >
                        <option value="">No status change</option>
                        <option value="investigating">Move to investigating</option>
                        <option value="monitoring">Move to monitoring</option>
                      </select>
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="font-medium">Root cause</span>
                      <input
                        name="rootCause"
                        className="w-full rounded-md border border-input bg-background px-3 py-2"
                      />
                    </label>
                  </div>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Update message</span>
                    <textarea
                      name="message"
                      rows={4}
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Resolution notes</span>
                    <textarea
                      name="resolutionNotes"
                      rows={4}
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <Button type="submit" variant="secondary">
                    Add update
                  </Button>
                </form>

                <form action={resolveAction} className="space-y-4 border-t border-border pt-6">
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Resolution summary</span>
                    <textarea
                      name="message"
                      rows={3}
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Final resolution notes</span>
                    <textarea
                      name="resolutionNotes"
                      rows={4}
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Final root cause</span>
                    <input
                      name="rootCause"
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <Button type="submit">Resolve incident</Button>
                </form>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
