import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageIncidents } from "@/lib/server/auth/permissions";
import {
  createAndLinkExternalIssueReference,
  createExternalIssueReferenceSchema,
  listLinkedExternalIssuesForIncident,
} from "@/lib/server/external-issues/external-issue-service";

type RouteContext = {
  params: Promise<{
    incidentId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const { incidentId } = await context.params;
    const linkedExternalIssues = await listLinkedExternalIssuesForIncident(
      user.id,
      incidentId,
      organizationContext.organization.id,
    );

    return NextResponse.json({ data: linkedExternalIssues });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
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

    const input = await parseJsonBody(request, createExternalIssueReferenceSchema);
    const { incidentId } = await context.params;
    const linkedExternalIssues = await createAndLinkExternalIssueReference(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      incidentId,
      input,
    );

    return NextResponse.json({ data: linkedExternalIssues });
  } catch (error) {
    return createErrorResponse(error);
  }
}
