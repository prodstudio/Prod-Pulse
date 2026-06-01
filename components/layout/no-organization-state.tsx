export function NoOrganizationState() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 rounded-lg border border-dashed border-border bg-card px-8 py-12">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Organization setup required
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          No active organization is attached to this user.
        </h1>
      </div>
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        Prod Pulse only exposes operational data inside an organization context. Add
        the current user to an organization in Supabase Auth and memberships before
        using the dashboard.
      </p>
    </section>
  );
}
