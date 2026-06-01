import Link from "next/link";
import { redirect } from "next/navigation";

import { getOptionalUser } from "@/lib/server/auth/guards";
import { hasSupabaseServerEnv } from "@/lib/server/supabase/client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getOptionalUser();

  if (user) {
    redirect("/dashboard");
  }

  const envReady = hasSupabaseServerEnv();

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,transparent_0%,color-mix(in_oklch,var(--accent)_8%,transparent)_100%)] px-6 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col justify-between rounded-lg border border-border/70 bg-card p-8 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] lg:p-10">
        <section className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              Prod Studio Internal
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight">
              Prod Pulse is the internal reliability command center for Prod-built SaaS.
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
              Monitor definitions, results, incidents, heartbeats, alert deliveries, and status
              preview state all come from persisted backend records.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/35 p-4">
              <p className="font-medium">Monitoring</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Real monitor inventory, scheduled runs, and persisted results.
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/35 p-4">
              <p className="font-medium">Incidents</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Threshold-based incident lifecycle from scheduled monitor evidence.
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/35 p-4">
              <p className="font-medium">Operations</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Slack alerts, heartbeat freshness, and internal status previews.
              </p>
            </div>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-4">
          <Link
            href="/login"
            aria-disabled={!envReady}
            className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ${
              envReady
                ? "bg-primary text-primary-foreground"
                : "pointer-events-none bg-muted text-muted-foreground opacity-60"
            }`}
          >
            Sign in
          </Link>
          <p className="text-sm text-muted-foreground">
            {envReady
              ? "Supabase Auth is configured for this deployment."
              : "Supabase environment variables are still missing for this deployment."}
          </p>
        </section>
      </div>
    </main>
  );
}
