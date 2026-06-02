import { NextResponse } from "next/server";

import { createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import {
  ciexInboundPayloadSchema,
  ingestCiexInboundIssue,
} from "@/lib/server/integrations/ciex-inbound-service";

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, ciexInboundPayloadSchema);
    const result = await ingestCiexInboundIssue(request, payload);

    return NextResponse.json({
      data: {
        issue: result.issue,
        suggestedIncidentIds: result.suggestedIncidentIds,
        created: result.created,
        updated: result.updated,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
