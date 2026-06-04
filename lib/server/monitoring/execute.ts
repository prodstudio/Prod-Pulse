import "server-only";

import { writeAuditLog } from "@/lib/server/audit/audit-log";
import type { ActiveOrganizationContext } from "@/lib/server/auth/organization-context";
import { processScheduledIncidentState } from "@/lib/server/incidents/incident-engine";
import { evaluateMonitor } from "@/lib/server/monitoring/evaluate";
import { persistMonitorExecutionResult } from "@/lib/server/monitoring/result-service";
import { sanitizeMonitorForAudit } from "@/lib/server/monitors/monitor-sanitization";
import { getRawMonitorForExecution } from "@/lib/server/monitors/monitor-service";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";
import type { RunnerMonitorRecord } from "@/lib/server/monitoring/runner-locks";

type ManualRunContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

function toRunnerMonitorRecord(monitor: Awaited<ReturnType<typeof getRawMonitorForExecution>>): RunnerMonitorRecord {
  return {
    ...monitor,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastScheduledBucket: null,
    lockedAt: null,
    lockExpiresAt: null,
    lockedByRunId: null,
  };
}

export async function executeManualMonitorRun(
  context: ManualRunContext,
  monitorId: string,
) {
  const adminClient = createSupabaseAdminClient();
  const monitor = await getRawMonitorForExecution(
    context.userId,
    monitorId,
    context.organization.id,
    adminClient,
  );
  const execution = await evaluateMonitor(monitor);
  const persistedResult = await persistMonitorExecutionResult(
    {
      actorUserId: context.userId,
      monitor,
      execution,
    },
    adminClient,
  );

  await processScheduledIncidentState(
    {
      monitor: toRunnerMonitorRecord(monitor),
      result: persistedResult,
      suppressedByMaintenanceWindowId: null,
    },
    adminClient,
  );

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "run",
    targetTable: "monitors",
    targetId: monitor.id,
    metadata: {
      monitor: sanitizeMonitorForAudit(monitor),
      result: {
        id: persistedResult.id,
        status: persistedResult.status,
        checkedAt: persistedResult.checkedAt,
        httpStatus: persistedResult.httpStatus,
        errorCode: persistedResult.errorCode,
      },
    },
    request: context.request,
  });

  return persistedResult;
}
