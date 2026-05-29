const queuePanels = [
  {
    title: "Monitors",
    description: "Monitor definitions and schedules land after the schema foundation is in place.",
  },
  {
    title: "Incidents",
    description: "Incident lifecycle tracking will bind to persisted monitor failures, not client-side placeholders.",
  },
  {
    title: "Alerts",
    description: "Slack is the first provider and will write delivery attempts and recovery history server-side.",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-md border border-border bg-card p-6 shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Command Center
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Operational shell wired, backend evidence pending.
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              This dashboard is intentionally structural only. Once monitor execution lands,
              every status band and incident row will read from persisted Supabase state.
            </p>
          </div>
        </div>
        <div className="rounded-md border border-dashed border-border bg-card/60 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Current State
          </p>
          <p className="mt-3 text-lg font-semibold">No monitor results persisted yet</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The shell is ready. The first real dataset will arrive through monitor results,
            incidents, and alert deliveries created in later passes.
          </p>
        </div>
      </section>
      <section className="grid gap-4 xl:grid-cols-3">
        {queuePanels.map((panel) => (
          <article key={panel.title} className="rounded-md border border-border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {panel.title}
            </h2>
            <p className="mt-3 text-lg font-semibold">{panel.title} pipeline not wired yet</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{panel.description}</p>
          </article>
        ))}
      </section>
      <section className="rounded-md border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Evidence Policy
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">
              The UI stays empty until the backend can prove something.
            </h2>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-md bg-muted/55 p-4">
            Health endpoint docs and validation helpers are part of this pass.
          </div>
          <div className="rounded-md bg-muted/55 p-4">
            Database schema includes schedules, locking, idempotency, and incident dedupe.
          </div>
          <div className="rounded-md bg-muted/55 p-4">
            Slack stays modeled structurally until actual alert delivery logic lands.
          </div>
        </div>
      </section>
    </div>
  );
}
