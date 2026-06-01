import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";

export function AppShell({
  children,
  userEmail,
  organizationName,
  role,
}: Readonly<{
  children: React.ReactNode;
  userEmail?: string | null;
  organizationName?: string | null;
  role?: string | null;
}>) {
  return (
    <div className="flex min-h-screen bg-[linear-gradient(180deg,color-mix(in_oklch,var(--accent)_7%,transparent),transparent_22%)]">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          userEmail={userEmail}
          organizationName={organizationName}
          role={role}
        />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
