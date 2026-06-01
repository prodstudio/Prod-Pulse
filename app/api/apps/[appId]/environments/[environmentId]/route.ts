import { NextResponse } from "next/server";

import {
  deleteEnvironment,
  getEnvironmentById,
  updateEnvironment,
  updateEnvironmentSchema,
} from "@/lib/server/apps/environment-service";
import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";

type RouteContext = {
  params: Promise<{
    appId: string;
    environmentId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageOperationalConfig(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const { appId, environmentId } = await context.params;
    const environment = await getEnvironmentById(
      user.id,
      environmentId,
      organizationContext.organization.id,
    );

    if (environment.appId !== appId) {
      throw new ApiError(404, "APP_ENVIRONMENT_NOT_FOUND", "The requested environment was not found.");
    }

    const input = await parseJsonBody(request, updateEnvironmentSchema);
    const updatedEnvironment = await updateEnvironment(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      environmentId,
      input,
    );

    return NextResponse.json({ data: updatedEnvironment });
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

    const { appId, environmentId } = await context.params;
    const environment = await getEnvironmentById(
      user.id,
      environmentId,
      organizationContext.organization.id,
    );

    if (environment.appId !== appId) {
      throw new ApiError(404, "APP_ENVIRONMENT_NOT_FOUND", "The requested environment was not found.");
    }

    const result = await deleteEnvironment(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      environmentId,
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return createErrorResponse(error);
  }
}
