import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { canManageAlerts } from "@/lib/server/auth/permissions";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { sendNotificationChannelTest } from "@/lib/server/alerts/notification-channel-service";

type RouteContext = {
  params: Promise<{
    channelId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageAlerts(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const { channelId } = await context.params;
    const result = await sendNotificationChannelTest(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      channelId,
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return createErrorResponse(error);
  }
}
