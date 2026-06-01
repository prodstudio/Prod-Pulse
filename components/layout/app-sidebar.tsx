import Link from "next/link";

const navItems = [
  { label: "Dashboard", href: "/dashboard", active: true },
  { label: "Apps", href: "/apps", active: true },
  { label: "Monitors", href: "/monitors", active: true },
  { label: "Incidents", href: "/incidents", active: true },
  { label: "Alerts", href: "/alerts/channels", active: true },
  { label: "Heartbeats", href: "/heartbeats", active: true },
  { label: "Status Preview", href: "#", active: false },
  { label: "Settings", href: "#", active: false },
];

export function AppSidebar() {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sidebar-primary">
          Prod Studio
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Prod Pulse</h1>
        <p className="mt-2 text-sm leading-6 text-sidebar-foreground/70">
          Internal reliability command center.
        </p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {navItems.map((item) =>
          item.active ? (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-md bg-sidebar-accent px-3 py-2 text-sm font-medium text-sidebar-accent-foreground"
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.label}
              className="rounded-md px-3 py-2 text-sm text-sidebar-foreground/52"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>
      <div className="border-t border-sidebar-border px-6 py-4 text-xs uppercase tracking-[0.18em] text-sidebar-foreground/50">
        Phase 7 heartbeat monitoring
      </div>
    </aside>
  );
}
