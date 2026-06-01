import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageStatusPages } from "@/lib/server/auth/permissions";
import {
  deleteStatusPageComponent,
  updateStatusPageComponent,
  updateStatusPageComponentSchema,
} from "@/lib/server/status-pages/status-page-service";

type RouteContext = {
  params: Promise<{
    statusPageId: string;
    componentId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageStatusPages(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const input = await parseJsonBody(request, updateStatusPageComponentSchema);
    const { statusPageId, componentId } = await context.params;
    const component = await updateStatusPageComponent(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      statusPageId,
      componentId,
      input,
    );

    return NextResponse.json({ data: component });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageStatusPages(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const { statusPageId, componentId } = await context.params;
    const result = await deleteStatusPageComponent(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      statusPageId,
      componentId,
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return createErrorResponse(error);
  }
}
