import { NextResponse } from "next/server";

import { ApiError, createErrorResponse } from "@/lib/server/api/errors";
import { parseJsonBody } from "@/lib/server/api/validation";
import { requireUser } from "@/lib/server/auth/guards";
import { requireOrgMembership } from "@/lib/server/auth/organization-context";
import { canManageHeartbeats } from "@/lib/server/auth/permissions";
import {
  deleteHeartbeat,
  getHeartbeatById,
  ingestHeartbeatPing,
  updateHeartbeat,
  updateHeartbeatSchema,
} from "@/lib/server/heartbeats/heartbeat-service";

type RouteContext = {
  params: Promise<{
    heartbeatId: string;
  }>;
};

function createSafeIngestErrorResponse(status: number) {
  return NextResponse.json({ ok: false }, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);
    const { heartbeatId } = await context.params;
    const heartbeat = await getHeartbeatById(
      user.id,
      heartbeatId,
      organizationContext.organization.id,
    );

    return NextResponse.json({ data: heartbeat });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { heartbeatId } = await context.params;
    const result = await ingestHeartbeatPing(heartbeatId, request);

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return createSafeIngestErrorResponse(404);
      }

      return createSafeIngestErrorResponse(400);
    }

    return createSafeIngestErrorResponse(500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageHeartbeats(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const input = await parseJsonBody(request, updateHeartbeatSchema);
    const { heartbeatId } = await context.params;
    const heartbeat = await updateHeartbeat(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      heartbeatId,
      input,
    );

    return NextResponse.json({ data: heartbeat });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const organizationContext = await requireOrgMembership(user.id);

    if (!canManageHeartbeats(organizationContext.membership.role)) {
      throw new ApiError(403, "ORG_ROLE_REQUIRED", "This action requires admin or owner access.");
    }

    const { heartbeatId } = await context.params;
    const result = await deleteHeartbeat(
      {
        userId: user.id,
        organization: organizationContext.organization,
        membership: organizationContext.membership,
        request,
      },
      heartbeatId,
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return createErrorResponse(error);
  }
}
