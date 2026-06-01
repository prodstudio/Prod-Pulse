import { NextResponse } from "next/server";
import { z } from "zod";

import { createErrorResponse } from "@/lib/server/api/errors";
import { parseSchema } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { listMonitorResultsForMonitor } from "@/lib/server/monitoring/result-service";

type RouteContext = {
  params: Promise<{
    monitorId: string;
  }>;
};

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const { monitorId } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    const query = parseSchema(querySchema, {
      limit: searchParams.get("limit") ?? undefined,
    });
    const results = await listMonitorResultsForMonitor(
      user.id,
      monitorId,
      organizationContext.organization.id,
      { limit: query.limit ?? 50 },
    );

    return NextResponse.json({ data: results });
  } catch (error) {
    return createErrorResponse(error);
  }
}
