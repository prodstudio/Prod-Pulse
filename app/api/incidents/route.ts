import { NextResponse } from "next/server";

import { createErrorResponse } from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { incidentFilterSchema, listIncidentsForOrganization } from "@/lib/server/incidents/incident-service";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const searchParams = new URL(request.url).searchParams;
    const query = parseSchema(incidentFilterSchema, {
      filter: searchParams.get("filter") ?? undefined,
    });
    const incidents = await listIncidentsForOrganization(
      user.id,
      organizationContext.organization.id,
      query.filter ?? "active",
    );

    return NextResponse.json({
      data: incidents,
      organization: organizationContext.organization,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
