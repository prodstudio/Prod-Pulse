import { NextResponse } from "next/server";

import {
  deleteApp,
  getAppById,
  updateApp,
  updateAppSchema,
} from "@/lib/server/apps/app-service";
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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const { appId } = await context.params;
    const app = await getAppById(user.id, appId, organizationContext.organization.id);

    return NextResponse.json({ data: app });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageOperationalConfig(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const { appId } = await context.params;
    const input = await parseJsonBody(request, updateAppSchema);
    const app = await updateApp(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      appId,
      input,
    );

    return NextResponse.json({ data: app });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageOperationalConfig(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const { appId } = await context.params;
    const result = await deleteApp(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      appId,
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return createErrorResponse(error);
  }
}
