import { NextResponse } from "next/server";

import { createErrorResponse } from "@/lib/server/api/errors";
import { runAlertDeliveryRunner } from "@/lib/server/alerts/alert-engine";
import {
  isAlertRunnerEnabled,
  isSlackAlertsEnabled,
  requireInternalJob,
} from "@/lib/server/jobs/require-internal-job";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireInternalJob(request);

    if (!isAlertRunnerEnabled()) {
      return NextResponse.json({
        data: {
          status: "skipped",
          reason: "runner_disabled",
        },
      });
    }

    if (!isSlackAlertsEnabled()) {
      return NextResponse.json({
        data: {
          status: "skipped",
          reason: "slack_disabled",
        },
      });
    }

    const summary = await runAlertDeliveryRunner();

    return NextResponse.json({
      data: {
        status: "completed",
        ...summary,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export { POST as GET };
