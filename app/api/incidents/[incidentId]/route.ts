import { NextResponse } from "next/server";

import { createErrorResponse } from "@/lib/server/api/errors";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { getIncidentById } from "@/lib/server/incidents/incident-service";

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
