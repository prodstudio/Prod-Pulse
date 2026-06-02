import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageIncidents } from "@/lib/server/auth/permissions";
import {
  updateIncidentCustomerImpact,
  updateIncidentCustomerImpactSchema,
} from "@/lib/server/external-issues/external-issue-service";
import { getIncidentById } from "@/lib/server/incidents/incident-service";

type RouteContext = {
  params: Promise<{
    incidentId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
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

    const input = await parseJsonBody(request, updateIncidentCustomerImpactSchema);
    const { incidentId } = await context.params;

    await updateIncidentCustomerImpact(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      incidentId,
      input,
    );

    const incident = await getIncidentById(
      user.id,
      incidentId,
      organizationContext.organization.id,
    );

    return NextResponse.json({ data: incident });
  } catch (error) {
    return createErrorResponse(error);
  }
}
