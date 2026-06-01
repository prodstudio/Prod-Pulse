import { NextResponse } from "next/server";

import { createApp, createAppSchema, listAppsForOrganization } from "@/lib/server/apps/app-service";
import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";

export async function GET() {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const apps = await listAppsForOrganization(organizationContext.organization.id);

    return NextResponse.json({
      data: apps,
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

    const input = await parseJsonBody(request, createAppSchema);
    const app = await createApp(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      input,
    );

    return NextResponse.json({ data: app }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
