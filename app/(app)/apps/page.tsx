import Link from "next/link";

import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { listAppsForOrganization } from "@/lib/server/apps/app-service";
import { requireAppSession } from "@/lib/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const apps = await listAppsForOrganization(session.organizationContext.organization.id);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Inventory
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Monitored apps</h1>
        <p className="text-sm text-muted-foreground">
          Persisted applications for {session.organizationContext.organization.name}.
        </p>
      </div>

      {apps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-sm text-muted-foreground">
          No monitored apps exist yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/35 text-left text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <tr>
                <th className="px-5 py-4 font-semibold">App</th>
                <th className="px-5 py-4 font-semibold">Status</th>
                <th className="px-5 py-4 font-semibold">Owner team</th>
                <th className="px-5 py-4 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id} className="border-t border-border">
                  <td className="px-5 py-4">
                    <Link href={`/apps/${app.id}`} className="font-medium tracking-tight">
                      {app.name}
                    </Link>
                    <p className="mt-1 text-muted-foreground">{app.slug}</p>
                  </td>
                  <td className="px-5 py-4 capitalize">{app.status}</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {app.ownerTeam ?? "Not set"}
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {new Date(app.createdAt).toLocaleDateString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
