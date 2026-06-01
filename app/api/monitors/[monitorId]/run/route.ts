import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canRunMonitors } from "@/lib/server/auth/permissions";
import { executeManualMonitorRun } from "@/lib/server/monitoring/execute";

type RouteContext = {
  params: Promise<{
    monitorId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canRunMonitors(organizationContext.membership.role)) {
      throw new ApiError(
        403,
        "ORG_ROLE_REQUIRED",
        "This action requires responder, admin, or owner access.",
      );
    }

    const { monitorId } = await context.params;
    const result = await executeManualMonitorRun(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      monitorId,
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
