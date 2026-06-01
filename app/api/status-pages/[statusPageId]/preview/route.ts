import { NextResponse } from "next/server";

import { createErrorResponse } from "@/lib/server/api/errors";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { getStatusPagePreview } from "@/lib/server/status-pages/status-page-service";

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
    const preview = await getStatusPagePreview(
      user.id,
      statusPageId,
      organizationContext.organization.id,
    );

    return NextResponse.json({ data: preview });
  } catch (error) {
    return createErrorResponse(error);
  }
}
