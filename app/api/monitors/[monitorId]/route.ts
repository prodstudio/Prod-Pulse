import { NextResponse } from "next/server";

import {
  deleteMonitor,
  getMonitorById,
  updateMonitor,
  updateMonitorSchema,
} from "@/lib/server/monitors/monitor-service";
import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageOperationalConfig } from "@/lib/server/auth/permissions";

type RouteContext = {
  params: Promise<{
    monitorId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const { monitorId } = await context.params;
    const monitor = await getMonitorById(user.id, monitorId, organizationContext.organization.id);

    return NextResponse.json({ data: monitor });
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

    const { monitorId } = await context.params;
    const input = await parseJsonBody(request, updateMonitorSchema);
    const monitor = await updateMonitor(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      monitorId,
      input,
    );

    return NextResponse.json({ data: monitor });
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

    const { monitorId } = await context.params;
    const result = await deleteMonitor(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      monitorId,
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return createErrorResponse(error);
  }
}
