import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { canManageAlerts } from "@/lib/server/auth/permissions";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import {
  createAlertRule,
  createAlertRuleSchema,
  listAlertRulesForOrganization,
} from "@/lib/server/alerts/alert-rule-service";

export async function GET() {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const rules = await listAlertRulesForOrganization(
      user.id,
      organizationContext.organization.id,
    );

    return NextResponse.json({
      data: rules,
      organization: organizationContext.organization,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageAlerts(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const input = await parseJsonBody(request, createAlertRuleSchema);
    const rule = await createAlertRule(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      input,
    );

    return NextResponse.json({ data: rule }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
