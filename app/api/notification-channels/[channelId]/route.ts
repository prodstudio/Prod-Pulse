import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { canManageAlerts } from "@/lib/server/auth/permissions";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import {
  deleteNotificationChannel,
  getNotificationChannelById,
  updateNotificationChannel,
  updateNotificationChannelSchema,
} from "@/lib/server/alerts/notification-channel-service";

type RouteContext = {
  params: Promise<{
    channelId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const { channelId } = await context.params;
    const channel = await getNotificationChannelById(
      user.id,
      channelId,
      organizationContext.organization.id,
    );

    return NextResponse.json({ data: channel });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageAlerts(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const input = await parseJsonBody(request, updateNotificationChannelSchema);
    const { channelId } = await context.params;
    const channel = await updateNotificationChannel(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      channelId,
      input,
    );

    return NextResponse.json({ data: channel });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageAlerts(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const { channelId } = await context.params;
    await deleteNotificationChannel(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      channelId,
    );

    return NextResponse.json({ data: { id: channelId, deleted: true } });
  } catch (error) {
    return createErrorResponse(error);
  }
}
