import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageIncidents } from "@/lib/server/auth/permissions";
import {
  resolveIncident as resolveIncidentService,
  resolveIncidentSchema,
} from "@/lib/server/incidents/incident-service";

type RouteContext = {
  params: Promise<{
    incidentId: string;
  }>;
};

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

    const input = await parseJsonBody(request, resolveIncidentSchema);
    const { incidentId } = await context.params;
    const incident = await resolveIncidentService(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      incidentId,
      input,
    );

    return NextResponse.json({ data: incident });
  } catch (error) {
    return createErrorResponse(error);
  }
}
