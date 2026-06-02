import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageIncidents } from "@/lib/server/auth/permissions";
import { unlinkExternalIssueFromIncident } from "@/lib/server/external-issues/external-issue-service";

type RouteContext = {
  params: Promise<{
    incidentId: string;
    externalIssueId: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageIncidents(organizationContext.membership.role)) {
      throw new ApiError(
        403,
        "ORG_ROLE_REQUIRED",
        "This action requires responder, admin, or owner access.",
      );
    }

    const { incidentId, externalIssueId } = await context.params;
    const linkedExternalIssues = await unlinkExternalIssueFromIncident(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      incidentId,
      externalIssueId,
    );

    return NextResponse.json({ data: linkedExternalIssues });
  } catch (error) {
    return createErrorResponse(error);
  }
}
