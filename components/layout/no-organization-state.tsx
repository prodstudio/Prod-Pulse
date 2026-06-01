import { bootstrapInitialOwnerAction } from "@/lib/server/auth/actions";
import {
  INITIAL_OWNER_BOOTSTRAP_TOKEN_ENV,
  getBootstrapAvailability,
} from "@/lib/server/auth/bootstrap-service";
import { requireAuthenticatedUser } from "@/lib/server/auth/guards";

export async function NoOrganizationState({
  errorCode,
  status,
}: {
  errorCode?: string;
  status?: string;
} = {}) {
  const user = await requireAuthenticatedUser();
  const bootstrapAvailability = await getBootstrapAvailability();

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 rounded-lg border border-dashed border-border bg-card px-8 py-12">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Organization setup required
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          No active organization is attached to this user.
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Signed in as {user.email ?? "an authenticated user"}. Prod Pulse only exposes
          operational data inside an organization context.
        </p>
      </div>

      {status === "bootstrap_complete" ? (
        <div className="rounded-lg border border-border bg-muted/35 p-5 text-sm text-foreground">
          Initial organization bootstrap completed. Refresh into the dashboard if the organization
          header has not updated yet.
        </div>
      ) : null}

      {errorCode ? (
        <div className="rounded-lg border border-border bg-muted/35 p-5 text-sm text-foreground">
          {errorCode === "validation_failed"
            ? "Bootstrap details are invalid."
            : errorCode === "forbidden"
              ? "Bootstrap is not available for this request."
              : errorCode === "conflict"
                ? "An organization with these details already exists."
                : "The request could not be completed."}
        </div>
      ) : null}

      {bootstrapAvailability === "available" ? (
        <div className="space-y-4 rounded-lg border border-border bg-muted/35 p-5">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Initial bootstrap</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              No active memberships exist yet. Complete the one-time bootstrap to create the
              first organization and an owner membership for this account.
            </p>
          </div>
          <form action={bootstrapInitialOwnerAction} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="fullName" className="text-sm font-medium">
                Full name
              </label>
              <input
                id="fullName"
                name="fullName"
                defaultValue=""
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="organizationName" className="text-sm font-medium">
                Organization name
              </label>
              <input
                id="organizationName"
                name="organizationName"
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="organizationSlug" className="text-sm font-medium">
                Organization slug
              </label>
              <input
                id="organizationSlug"
                name="organizationSlug"
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="bootstrapToken" className="text-sm font-medium">
                Bootstrap token
              </label>
              <input
                id="bootstrapToken"
                name="bootstrapToken"
                type="password"
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Create initial organization
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {bootstrapAvailability === "token_not_configured" ? (
        <div className="rounded-lg border border-border bg-muted/35 p-5 text-sm leading-6 text-muted-foreground">
          No active memberships exist yet, but initial bootstrap is locked until the server sets
          <code className="mx-1 rounded bg-background px-2 py-1 text-foreground">
            {INITIAL_OWNER_BOOTSTRAP_TOKEN_ENV}
          </code>
          .
        </div>
      ) : null}

      {bootstrapAvailability === "memberships_exist" ? (
        <div className="rounded-lg border border-border bg-muted/35 p-5 text-sm leading-6 text-muted-foreground">
          Active organizations already exist in this deployment. Ask an existing owner or admin to
          add this user to the correct organization.
        </div>
      ) : null}
    </section>
  );
}
