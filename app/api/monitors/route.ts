import { NextResponse } from "next/server";

import {
  createMonitor,
  createMonitorSchema,
  listMonitorsForOrganization,
} from "@/lib/server/monitors/monitor-service";
import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";

export async function GET() {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const monitors = await listMonitorsForOrganization(organizationContext.organization.id);

    return NextResponse.json({
      data: monitors,
      organization: organizationContext.organization,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageOperationalConfig(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const input = await parseJsonBody(request, createMonitorSchema);
    const monitor = await createMonitor(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      input,
    );

    return NextResponse.json({ data: monitor }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
