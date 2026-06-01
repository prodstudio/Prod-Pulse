import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { canManageAlerts } from "@/lib/server/auth/permissions";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import {
  deleteAlertRule,
  getAlertRuleById,
  updateAlertRule,
  updateAlertRuleSchema,
} from "@/lib/server/alerts/alert-rule-service";

type RouteContext = {
  params: Promise<{
    ruleId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const { ruleId } = await context.params;
    const rule = await getAlertRuleById(
      user.id,
      ruleId,
      organizationContext.organization.id,
    );

    return NextResponse.json({ data: rule });
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

    const input = await parseJsonBody(request, updateAlertRuleSchema);
    const { ruleId } = await context.params;
    const rule = await updateAlertRule(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      ruleId,
      input,
    );

    return NextResponse.json({ data: rule });
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

    const { ruleId } = await context.params;
    await deleteAlertRule(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      ruleId,
    );

    return NextResponse.json({ data: { id: ruleId, deleted: true } });
  } catch (error) {
    return createErrorResponse(error);
  }
}
