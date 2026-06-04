import Link from "next/link";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { requireAppSession } from "@/lib/server/auth/guards";
import { listCiexExternalIssuesForOrganization } from "@/lib/server/external-issues/external-issue-service";

export const dynamic = "force-dynamic";

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

export default async function ExternalIssuesPage() {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const organization = session.organizationContext.organization;
  const issues = await listCiexExternalIssuesForOrganization(
    session.user.id,
    organization.id,
  );

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          External issues
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">CIEX external issues</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Read-only view of CIEX ticket events received through the Prod Pulse webhook receiver.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Received CIEX tickets</h2>
            <p className="text-sm text-muted-foreground">
              Scoped to the active organization and ordered by most recently updated first.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Active organization: <span className="font-medium text-foreground">{organization.name}</span>
          </p>
        </div>

        {issues.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            No CIEX external issues received yet.
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {issues.map((issue) => (
              <li key={issue.id} className="rounded-md border border-border px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/external-issues/${issue.id}`}
                        className="text-base font-semibold tracking-tight hover:underline"
                      >
                        {issue.title}
                      </Link>
                      <span
                        className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusBadgeClass(issue.status)}`}
                      >
                        {formatLabel(issue.status, "unknown")}
                      </span>
                      <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {formatLabel(issue.priority, "unprioritized")}
                      </span>
                      <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {issue.linkedIncidentCount > 0 ? `linked ${issue.linkedIncidentCount}` : "unlinked"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>{issue.customerReference ?? "Unknown customer reference"}</span>
                      <span>·</span>
                      <span>{issue.externalKey ?? issue.externalId}</span>
                    </div>

                    <p className="text-sm leading-6 text-muted-foreground">
                      {issue.summary ?? "No CIEX summary was provided for this external issue."}
                    </p>
                  </div>

                  <div className="min-w-48 space-y-2 text-right text-sm text-muted-foreground">
                    <p>Updated {formatTimestamp(issue.updatedAt)}</p>
                    {issue.sourceUrl ? (
                      <Link
                        href={issue.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-md border border-border px-3 py-2 text-sm text-foreground"
                      >
                        Open source ticket
                      </Link>
                    ) : (
                      <p>No source link</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
