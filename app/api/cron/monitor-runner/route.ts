import { NextResponse } from "next/server";

import { createErrorResponse } from "@/lib/server/api/errors";
import { requireInternalJob, isMonitorRunnerEnabled } from "@/lib/server/jobs/require-internal-job";
import { runScheduledMonitorRunner } from "@/lib/server/monitoring/runner-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireInternalJob(request);

    if (!isMonitorRunnerEnabled()) {
      return NextResponse.json({
        data: {
          status: "skipped",
          reason: "runner_disabled",
        },
      });
    }

    const summary = await runScheduledMonitorRunner();

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
