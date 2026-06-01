import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import {
  getActionErrorMessage,
  getActionErrorRedirectValue,
} from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";
import { requireAppSession } from "@/lib/server/auth/guards";
import { canManageStatusPages } from "@/lib/server/auth/permissions";
import {
  createStatusPage,
  createStatusPageSchema,
  listStatusPagesForOrganization,
} from "@/lib/server/status-pages/status-page-service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function StatusPagesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const organization = session.organizationContext.organization;
  const canMutate = canManageStatusPages(session.organizationContext.membership.role);
  const [statusPages, params] = await Promise.all([
    listStatusPagesForOrganization(session.user.id, organization.id),
    searchParams,
  ]);
  const errorMessage = getActionErrorMessage(
    typeof params.error === "string" ? params.error : null,
  );
  const status = typeof params.status === "string" ? params.status : null;

  async function createStatusPageAction(formData: FormData) {
    "use server";

    const actionSession = await requireAppSession();

    if (!actionSession.organizationContext) {
      redirect("/dashboard");
    }

    if (!canManageStatusPages(actionSession.organizationContext.membership.role)) {
      redirect("/status-pages?error=forbidden");
    }

    try {
      const created = await createStatusPage(
        {
          userId: actionSession.user.id,
          organization: actionSession.organizationContext.organization,
          membership: actionSession.organizationContext.membership,
        },
        parseSchema(createStatusPageSchema, {
          name: String(formData.get("name") ?? ""),
          slug: String(formData.get("slug") ?? ""),
          description: formData.get("description")
            ? String(formData.get("description"))
            : null,
          isPublic: formData.get("isPublic") === "on",
        }),
      );

      revalidatePath("/status-pages");
      redirect(`/status-pages/${created.id}?status=created`);
    } catch (error) {
      redirect(`/status-pages?error=${getActionErrorRedirectValue(error)}`);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Status preview
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Internal status pages</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Internal-only preview pages that map apps, environments, and monitors into a clean
          operational view derived from persisted incidents, results, maintenance windows, and
          heartbeat-backed monitor state.
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

      {!canMutate ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-4 text-sm text-muted-foreground">
          This surface is read-only for your current role.
        </div>
      ) : (
        <section className="rounded-lg border border-border bg-card p-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Create internal status page</h2>
            <p className="text-sm text-muted-foreground">
              This does not publish a public page. It only creates an internal preview surface for
              Prod Studio operators.
            </p>
          </div>

          <form action={createStatusPageAction} className="mt-5 grid gap-4 lg:grid-cols-2">
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
            <label className="space-y-2 text-sm lg:col-span-2">
              <span className="font-medium">Description</span>
              <textarea
                name="description"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="isPublic" className="size-4" />
              <span>
                Preserve the reserved public flag value without exposing any public route.
              </span>
            </label>
            <div className="lg:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
              >
                Create status page
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Configured status pages</h2>
            <p className="text-sm text-muted-foreground">
              Each page stays internal and authenticated in this MVP.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Active organization: <span className="font-medium text-foreground">{organization.name}</span>
          </p>
        </div>

        {statusPages.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            No internal status pages exist yet.
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Slug</th>
                  <th className="pb-3 font-medium">Components</th>
                  <th className="pb-3 font-medium">Internal flag</th>
                  <th className="pb-3 font-medium">Updated</th>
                  <th className="pb-3 font-medium">Open</th>
                </tr>
              </thead>
              <tbody>
                {statusPages.map((page) => (
                  <tr key={page.id} className="border-t border-border align-top">
                    <td className="py-4">
                      <p className="font-medium">{page.name}</p>
                      {page.description ? (
                        <p className="mt-1 max-w-md text-muted-foreground">{page.description}</p>
                      ) : null}
                    </td>
                    <td className="py-4 text-muted-foreground">{page.slug}</td>
                    <td className="py-4 text-muted-foreground">{page.componentCount}</td>
                    <td className="py-4 text-muted-foreground">
                      {page.isPublic ? "Reserved flag set" : "Internal only"}
                    </td>
                    <td className="py-4 text-muted-foreground">{formatTimestamp(page.updatedAt)}</td>
                    <td className="py-4">
                      <Link
                        href={`/status-pages/${page.id}`}
                        className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
                      >
                        Manage preview
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
