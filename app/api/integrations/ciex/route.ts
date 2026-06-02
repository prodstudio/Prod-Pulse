import { NextResponse } from "next/server";

import { createErrorResponse } from "@/lib/server/api/errors";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import {
  createCiexIntegration,
  getCiexIntegrationConfigForOrganization,
} from "@/lib/server/integrations/ciex-config-service";

export async function GET() {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const integration = await getCiexIntegrationConfigForOrganization(
      user.id,
      organizationContext.organization.id,
    );

    return NextResponse.json({
      data: integration,
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
    const result = await createCiexIntegration(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
    );

    return NextResponse.json(
      {
        data: result.integration,
        secret: result.plaintextSecret,
      },
      { status: 201 },
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}
