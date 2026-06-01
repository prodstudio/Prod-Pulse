import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageStatusPages } from "@/lib/server/auth/permissions";
import {
  deleteStatusPage,
  getStatusPageById,
  updateStatusPage,
  updateStatusPageSchema,
} from "@/lib/server/status-pages/status-page-service";

type RouteContext = {
  params: Promise<{
    statusPageId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const { statusPageId } = await context.params;
    const statusPage = await getStatusPageById(
      user.id,
      statusPageId,
      organizationContext.organization.id,
    );

    return NextResponse.json({ data: statusPage });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageStatusPages(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const input = await parseJsonBody(request, updateStatusPageSchema);
    const { statusPageId } = await context.params;
    const statusPage = await updateStatusPage(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      statusPageId,
      input,
    );

    return NextResponse.json({ data: statusPage });
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

    const { statusPageId } = await context.params;
    const result = await deleteStatusPage(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      statusPageId,
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return createErrorResponse(error);
  }
}
