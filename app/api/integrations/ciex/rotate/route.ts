import { NextResponse } from "next/server";

import { createErrorResponse } from "@/lib/server/api/errors";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { rotateCiexIntegrationKey } from "@/lib/server/integrations/ciex-config-service";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const result = await rotateCiexIntegrationKey(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
    );

    return NextResponse.json({
      data: result.integration,
      secret: result.plaintextSecret,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
