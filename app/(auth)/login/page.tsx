import Link from "next/link";

import { Button } from "@/components/ui/button";
import { hasSupabaseServerEnv } from "@/lib/server/supabase/client";

export const metadata = {
  title: "Login | Prod Pulse",
};

export default function LoginPage() {
  const envReady = hasSupabaseServerEnv();

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,transparent_0%,color-mix(in_oklch,var(--accent)_8%,transparent)_100%)] px-6 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-stretch overflow-hidden rounded-lg border border-border/70 bg-card shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)]">
        <section className="flex flex-1 flex-col justify-between bg-sidebar px-8 py-8 text-sidebar-foreground lg:px-10">
          <div className="space-y-8">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sidebar-primary">
                Prod Studio Internal
              </p>
              <h1 className="max-w-md text-4xl font-semibold tracking-tight">
                Prod Pulse keeps operations grounded in persisted evidence.
              </h1>
              <p className="max-w-lg text-sm leading-6 text-sidebar-foreground/76">
                This foundation pass wires the app shell, health contract, and database
                schema. Interactive authentication and live monitoring workflows land next.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-sidebar-foreground/82 sm:grid-cols-2">
              <div className="rounded-md border border-sidebar-border bg-sidebar-accent/55 p-4">
                <p className="font-medium">Health endpoint contract</p>
                <p className="mt-1 text-sidebar-foreground/72">
                  Standardized application health responses for Tiquer, Gama, Dent Hail,
                  and future Prod apps.
                </p>
              </div>
              <div className="rounded-md border border-sidebar-border bg-sidebar-accent/55 p-4">
                <p className="font-medium">Database-first monitoring model</p>
                <p className="mt-1 text-sidebar-foreground/72">
                  Schedules, incidents, maintenance suppression, and alert history are all
                  persisted server-side.
                </p>
              </div>
            </div>
          </div>
          <p className="text-xs uppercase tracking-[0.2em] text-sidebar-foreground/48">
            No fake dashboard data in this foundation pass.
          </p>
        </section>
        <section className="flex w-full max-w-xl flex-col justify-center bg-card px-8 py-10 lg:px-10">
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Access
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">Authentication wiring stub</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Protected routes are in place. Interactive sign-in is intentionally deferred
                until the database foundation and role model are live.
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/55 p-4 text-sm leading-6">
              <p className="font-medium text-foreground">
                {envReady ? "Supabase environment detected." : "Supabase environment missing."}
              </p>
              <p className="mt-2 text-muted-foreground">
                {envReady
                  ? "Interactive sign-in can be added without changing the server/client boundary."
                  : "Populate the environment variables from .env.example before wiring live authentication."}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button disabled className="rounded-md">
                Sign in wiring lands next
              </Button>
              <Link
                href="https://supabase.com/docs/guides/auth"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Supabase Auth reference
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
