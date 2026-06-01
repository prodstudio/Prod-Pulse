import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageStatusPages } from "@/lib/server/auth/permissions";
import {
  createStatusPageComponent,
  createStatusPageComponentSchema,
} from "@/lib/server/status-pages/status-page-service";

type RouteContext = {
  params: Promise<{
    statusPageId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageStatusPages(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const input = await parseJsonBody(request, createStatusPageComponentSchema);
    const { statusPageId } = await context.params;
    const component = await createStatusPageComponent(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      statusPageId,
      input,
    );

    return NextResponse.json({ data: component }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
