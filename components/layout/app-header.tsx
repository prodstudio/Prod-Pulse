import { CalendarDays, ShieldCheck } from "lucide-react";

export function AppHeader({ userEmail }: { userEmail?: string | null }) {
  const now = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Foundation Pass
        </p>
        <h2 className="text-lg font-semibold tracking-tight">
          Protected operational shell
        </h2>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <CalendarDays className="size-4" />
          {now}
        </span>
        <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <ShieldCheck className="size-4" />
          {userEmail ?? "No active user"}
        </span>
      </div>
    </header>
  );
}
