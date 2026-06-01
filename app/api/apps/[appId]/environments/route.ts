import { NextResponse } from "next/server";

import {
  createEnvironment,
  createEnvironmentSchema,
} from "@/lib/server/apps/environment-service";
import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";

type RouteContext = {
  params: Promise<{
    appId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageOperationalConfig(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const { appId } = await context.params;
    const input = await parseJsonBody(request, createEnvironmentSchema);
    const environment = await createEnvironment(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      appId,
      input,
    );

    return NextResponse.json({ data: environment }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
