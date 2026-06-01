import { AppShell } from "@/components/layout/app-shell";
import { requireAppSession } from "@/lib/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function ProtectedAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireAppSession();

  return (
    <AppShell
      userEmail={session.user.email}
      organizationName={session.organizationContext?.organization.name ?? null}
      role={session.organizationContext?.membership.role ?? null}
    >
      {children}
    </AppShell>
  );
}
