import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { signInWithPasswordAction } from "@/lib/server/auth/actions";
import { getOptionalUser } from "@/lib/server/auth/guards";
import {
  getDefaultPostLoginPath,
  sanitizeRedirectTarget,
} from "@/lib/server/auth/redirects";
import { hasSupabaseServerEnv } from "@/lib/server/supabase/client";

export const metadata = {
  title: "Login | Prod Pulse",
};

function getLoginMessage(errorCode: string | undefined, status: string | undefined) {
  if (status === "signed_out") {
    return "Signed out.";
  }

  switch (errorCode) {
    case "validation_failed":
      return "Enter a valid email address and password.";
    case "unauthorized":
      return "The email or password is invalid.";
    case "request_failed":
      return "The request could not be completed.";
    default:
      return null;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getOptionalUser();
  const params = (await searchParams) ?? {};
  const redirectTarget = sanitizeRedirectTarget(
    typeof params.next === "string" ? params.next : null,
    getDefaultPostLoginPath(),
  );

  if (user) {
    redirect(redirectTarget);
  }

  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const status = typeof params.status === "string" ? params.status : undefined;
  const envReady = hasSupabaseServerEnv();
  const message = getLoginMessage(errorCode, status);

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
                Sign in to Prod Pulse.
              </h1>
              <p className="max-w-lg text-sm leading-6 text-sidebar-foreground/76">
                Access the live command center for apps, monitors, incidents, alerts, heartbeats,
                and internal status previews.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-sidebar-foreground/82 sm:grid-cols-2">
              <div className="rounded-md border border-sidebar-border bg-sidebar-accent/55 p-4">
                <p className="font-medium">Persisted operational state</p>
                <p className="mt-1 text-sidebar-foreground/72">
                  Dashboard and detail views read directly from monitored apps, monitor results,
                  incidents, and alert history.
                </p>
              </div>
              <div className="rounded-md border border-sidebar-border bg-sidebar-accent/55 p-4">
                <p className="font-medium">Role-scoped access</p>
                <p className="mt-1 text-sidebar-foreground/72">
                  Membership and organization role checks remain server-enforced after sign-in.
                </p>
              </div>
            </div>
          </div>
          <p className="text-xs uppercase tracking-[0.2em] text-sidebar-foreground/48">
            No fake dashboard data.
          </p>
        </section>
        <section className="flex w-full max-w-xl flex-col justify-center bg-card px-8 py-10 lg:px-10">
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Access
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">Email and password</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Use a Supabase Auth user that is already registered for this workspace.
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/55 p-4 text-sm leading-6">
              <p className="font-medium text-foreground">
                {envReady ? "Supabase environment detected." : "Supabase environment missing."}
              </p>
              <p className="mt-2 text-muted-foreground">
                {envReady
                  ? "Interactive sign-in is active."
                  : "Populate the Supabase environment variables before enabling live authentication."}
              </p>
            </div>
            {message ? (
              <div className="rounded-md border border-border bg-muted/55 px-4 py-3 text-sm text-foreground">
                {message}
              </div>
            ) : null}
            <form action={signInWithPasswordAction} className="space-y-4">
              <input type="hidden" name="next" value={redirectTarget} />
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <Button type="submit" className="rounded-md" disabled={!envReady}>
                Sign in
              </Button>
            </form>
            <Link
              href="https://supabase.com/docs/guides/auth"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Supabase Auth reference
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
