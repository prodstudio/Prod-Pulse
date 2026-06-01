import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageHeartbeats } from "@/lib/server/auth/permissions";
import { rotateHeartbeatToken } from "@/lib/server/heartbeats/heartbeat-service";

type RouteContext = {
  params: Promise<{
    heartbeatId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageHeartbeats(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const { heartbeatId } = await context.params;
    const rotated = await rotateHeartbeatToken(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      heartbeatId,
    );

    return NextResponse.json({ data: rotated });
  } catch (error) {
    return createErrorResponse(error);
  }
}
