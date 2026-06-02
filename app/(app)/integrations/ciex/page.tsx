import { NoOrganizationState } from "@/components/layout/no-organization-state";
import { CiexConfigPanel } from "@/components/integrations/ciex-config-panel";
import { requireAppSession } from "@/lib/server/auth/guards";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";
import { getCiexIntegrationConfigForOrganization } from "@/lib/server/integrations/ciex-config-service";

export const dynamic = "force-dynamic";

export default async function CiexIntegrationPage() {
  const session = await requireAppSession();

  if (!session.organizationContext) {
    return <NoOrganizationState />;
  }

  const canManage = canManageOperationalConfig(session.organizationContext.membership.role);
  const receiverPath = "/api/integrations/ciex/inbound";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? null;
  const receiverUrl = baseUrl ? `${baseUrl}${receiverPath}` : null;
  const integration = canManage
    ? await getCiexIntegrationConfigForOrganization(
        session.user.id,
        session.organizationContext.organization.id,
      )
    : null;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Integrations
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">CIEX webhook receiver</h1>
        <p className="text-sm text-muted-foreground">
          Configure the CIEX to Prod Pulse webhook receiver used for ticket event delivery.
        </p>
      </section>

      {!canManage ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-4 text-sm text-muted-foreground">
          This page requires admin or owner access.
        </div>
      ) : (
        <CiexConfigPanel
          initialConfig={integration}
          receiverPath={receiverPath}
          receiverUrl={receiverUrl}
        />
      )}
    </div>
  );
}
