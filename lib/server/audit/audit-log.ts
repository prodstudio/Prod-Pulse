import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";
import { mapPostgresError } from "@/lib/server/api/errors";

type AuditActionType =
  | "create"
  | "update"
  | "delete"
  | "rotate_secret"
  | "test"
  | "run"
  | "acknowledge"
  | "assign"
  | "resolve"
  | "recover"
  | "suppress"
  | "publish"
  | "unpublish"
  | "system";

type AuditActorType = "user" | "system" | "heartbeat";

type WriteAuditLogInput = {
  organizationId?: string | null;
  actorType: AuditActorType;
  actorUserId?: string | null;
  actionType: AuditActionType;
  targetTable: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  request?: Request;
};

function getIpAddress(request?: Request) {
  const forwarded = request?.headers.get("x-forwarded-for");

  if (!forwarded) {
    return null;
  }

  return forwarded.split(",")[0]?.trim() ?? null;
}

export async function writeAuditLog(input: WriteAuditLogInput) {
  const adminClient = createSupabaseAdminClient();

  const { error } = await adminClient.from("audit_logs").insert({
    organization_id: input.organizationId ?? null,
    actor_type: input.actorType,
    actor_user_id: input.actorUserId ?? null,
    action_type: input.actionType,
    target_table: input.targetTable,
    target_id: input.targetId ?? null,
    metadata: input.metadata ?? {},
    ip_address: getIpAddress(input.request),
    user_agent: input.request?.headers.get("user-agent") ?? null,
  });

  if (error) {
    throw mapPostgresError(error);
  }
}
