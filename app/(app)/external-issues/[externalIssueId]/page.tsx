import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { Button } from "@/components/ui/button";
import { NoOrganizationState } from "@/components/layout/no-organization-state";
import {
  ApiError,
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { requireAppSession, requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageIncidents } from "@/lib/server/auth/permissions";
import {
  createIncidentFromExternalIssue,
  getExternalIssueDetailById,
  linkExternalIssueToIncident,
} from "@/lib/server/external-issues/external-issue-service";
import { listIncidentsForOrganization } from "@/lib/server/incidents/incident-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    externalIssueId: string;
  }>;
  searchParams: Promise<{
    error?: string;
    status?: string;
  }>;
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusBadgeClass(status: string | null) {
  switch (status) {
    case "open":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700";
    case "in_progress":
      return "border-blue-500/40 bg-blue-500/10 text-blue-700";
    case "resolved":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
    case "closed":
      return "border-slate-500/40 bg-slate-500/10 text-slate-700";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function formatLabel(value: string | null, fallback: string) {
  if (!value) {
    return fallback;
  }

  return value.replace(/_/g, " ");
}

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

export default async function ExternalIssueDetailPage({ params, searchParams }: PageProps) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const { externalIssueId } = await params;
  const [issue, incidents, statusParams] = await Promise.all([
    getExternalIssueDetailById(
      session.user.id,
      externalIssueId,
      session.organizationContext.organization.id,
    ).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }

      throw error;
    }),
    listIncidentsForOrganization(
      session.user.id,
      session.organizationContext.organization.id,
      "all",
    ),
    searchParams,
  ]);

  if (!issue) {
    notFound();
  }

  const canMutate = canManageIncidents(session.organizationContext.membership.role);
  const actionError = getActionErrorMessage(statusParams.error);

  async function linkIncidentAction(formData: FormData) {
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

      const incidentId = String(formData.get("incidentId") ?? "");

      if (!incidentId) {
        throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed.");
      }

      await linkExternalIssueToIncident(
        {
          userId: user.id,
          organization: organizationContext.organization,
          membership: organizationContext.membership,
        },
        incidentId,
        externalIssueId,
      );

      revalidatePath("/external-issues");
      revalidatePath(`/external-issues/${externalIssueId}`);
      revalidatePath(`/incidents/${incidentId}`);
      redirect(`/external-issues/${externalIssueId}?status=linked`);
    } catch (error) {
      redirect(`/external-issues/${externalIssueId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  async function createIncidentAction() {
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

      const incident = await createIncidentFromExternalIssue(
        {
          userId: user.id,
          organization: organizationContext.organization,
          membership: organizationContext.membership,
        },
        externalIssueId,
      );

      revalidatePath("/external-issues");
      revalidatePath(`/external-issues/${externalIssueId}`);
      revalidatePath("/incidents");
      revalidatePath(`/incidents/${incident.id}`);
      redirect(`/external-issues/${externalIssueId}?status=incident_created`);
    } catch (error) {
      redirect(`/external-issues/${externalIssueId}?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          External issues
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{issue.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusBadgeClass(issue.status)}`}
          >
            {formatLabel(issue.status, "unknown")}
          </span>
          <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {formatLabel(issue.priority, "unprioritized")}
          </span>
        </div>
        {statusParams.status ? (
          <p className="text-sm text-emerald-600">External issue action completed: {statusParams.status}.</p>
        ) : null}
        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ConfigRow label="Customer reference" value={issue.customerReference ?? "Unavailable"} />
        <ConfigRow label="External key" value={issue.externalKey ?? "Unavailable"} />
        <ConfigRow label="External id" value={issue.externalId} />
        <ConfigRow label="Updated" value={formatTimestamp(issue.updatedAt)} />
        <ConfigRow label="Created" value={formatTimestamp(issue.createdAt)} />
        <ConfigRow label="Linked incidents" value={String(issue.linkedIncidentCount)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Issue summary</h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {issue.summary ?? "No CIEX summary was provided for this external issue."}
            </p>
            {issue.sourceUrl ? (
              <Link
                href={issue.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground"
              >
                Open source ticket
              </Link>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Linked incidents</h2>
            {issue.linkedIncidents.length === 0 ? (
              <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                No incidents are linked to this external issue yet.
              </div>
            ) : (
              <ul className="mt-6 space-y-3">
                {issue.linkedIncidents.map((incident) => (
                  <li key={incident.id} className="rounded-md border border-border px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-2">
                        <Link
                          href={`/incidents/${incident.id}`}
                          className="text-base font-semibold tracking-tight hover:underline"
                        >
                          {incident.title}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {incident.severity}
                          </span>
                          <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {incident.status}
                          </span>
                        </div>
                      </div>
                      <div className="text-right text-sm text-muted-foreground">
                        <p>Created {formatTimestamp(incident.createdAt)}</p>
                        <p>Updated {formatTimestamp(incident.updatedAt)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">Actions</h2>
            {!canMutate ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Responder, admin, or owner access is required to link or create incidents.
              </p>
            ) : (
              <div className="mt-4 space-y-6">
                <form action={linkIncidentAction} className="space-y-4">
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Link to existing incident</span>
                    <select
                      name="incidentId"
                      className="w-full rounded-md border border-input bg-background px-3 py-2"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Select an incident
                      </option>
                      {incidents.map((incident) => (
                        <option key={incident.id} value={incident.id}>
                          {incident.title} · {incident.status} · {incident.severity}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit" variant="secondary">
                    Link incident
                  </Button>
                </form>

                <div className="border-t border-border pt-6">
                  {issue.canCreateIncident ? (
                    <form action={createIncidentAction}>
                      <Button type="submit">Create incident from external issue</Button>
                    </form>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This external issue cannot create an incident yet because it does not include
                      the internal app and monitor references required by the current incident
                      schema.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
