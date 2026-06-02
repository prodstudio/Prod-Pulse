import "server-only";

import { z } from "zod";

import { ApiError, mapPostgresError } from "@/lib/server/api/errors";
import { writeAuditLog } from "@/lib/server/audit/audit-log";
import {
  requireOrgMembership,
  requireResourceAccess,
  type ActiveOrganizationContext,
} from "@/lib/server/auth/organization-context";
import { createSupabaseAdminClient } from "@/lib/server/supabase/admin";
import {
  sanitizeExternalIssueCustomerReference,
  sanitizeExternalIssueForAudit,
  sanitizeExternalIssueIdentifier,
  sanitizeExternalIssueKey,
  sanitizeExternalIssuePriority,
  sanitizeExternalIssueSourceKind,
  sanitizeExternalIssueStatus,
  sanitizeExternalIssueSummary,
  sanitizeExternalIssueTitle,
  sanitizeExternalIssueUrl,
  toSafeExternalIssue,
  type RawExternalIssueRecord,
  type SafeExternalIssue,
} from "@/lib/server/external-issues/external-issue-sanitization";
import { sanitizeIncidentText } from "@/lib/server/incidents/incident-sanitization";

type AdminLike = ReturnType<typeof createSupabaseAdminClient>;

type ExternalIssueServiceContext = {
  userId: string;
  organization: ActiveOrganizationContext["organization"];
  membership: ActiveOrganizationContext["membership"];
  request?: Request;
};

type ExternalIssueLookupRow = Record<string, unknown>;

export const externalIssueSourceKinds = ["ciex", "manual", "other"] as const;

export const createExternalIssueReferenceSchema = z.object({
  sourceKind: z.enum(externalIssueSourceKinds),
  externalId: z.string().trim().min(1).max(160),
  externalKey: z.string().trim().max(160).optional().nullable(),
  title: z.string().trim().min(1).max(160),
  status: z.string().trim().max(80).optional().nullable(),
  priority: z.string().trim().max(80).optional().nullable(),
  sourceUrl: z.string().trim().max(500).optional().nullable(),
  customerReference: z.string().trim().max(160).optional().nullable(),
  summary: z.string().trim().max(2000).optional().nullable(),
});

export const updateIncidentCustomerImpactSchema = z.object({
  customerImpactSummary: z.string().trim().max(4000).optional().nullable(),
  customerImpactNotes: z.string().trim().max(4000).optional().nullable(),
});

export type CreateExternalIssueReferenceInput = z.infer<typeof createExternalIssueReferenceSchema>;
export type UpdateIncidentCustomerImpactInput = z.infer<typeof updateIncidentCustomerImpactSchema>;

function mapExternalIssueRow(row: ExternalIssueLookupRow): RawExternalIssueRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    integrationId: (row.integration_id as string | null) ?? null,
    sourceKind: String(row.source_kind),
    externalId: String(row.external_id),
    externalKey: (row.external_key as string | null) ?? null,
    title: String(row.title),
    status: (row.status as string | null) ?? null,
    priority: (row.priority as string | null) ?? null,
    sourceUrl: (row.source_url as string | null) ?? null,
    customerReference: (row.customer_reference as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    firstSeenAt: (row.first_seen_at as string | null) ?? null,
    lastSyncedAt: (row.last_synced_at as string | null) ?? null,
    sourceCreatedAt: (row.source_created_at as string | null) ?? null,
    sourceUpdatedAt: (row.source_updated_at as string | null) ?? null,
    relatedAppId: (row.related_app_id as string | null) ?? null,
    relatedEnvironmentId: (row.related_environment_id as string | null) ?? null,
    relatedMonitorId: (row.related_monitor_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    linkedAt: (row.linked_at as string | null) ?? null,
  };
}

function toExternalIssueLookupRow(row: unknown): ExternalIssueLookupRow {
  return row as ExternalIssueLookupRow;
}

const EXTERNAL_ISSUE_SELECT = [
  "id",
  "organization_id",
  "integration_id",
  "source_kind",
  "external_id",
  "external_key",
  "title",
  "status",
  "priority",
  "source_url",
  "customer_reference",
  "summary",
  "created_by",
  "first_seen_at",
  "last_synced_at",
  "source_created_at",
  "source_updated_at",
  "related_app_id",
  "related_environment_id",
  "related_monitor_id",
  "created_at",
  "updated_at",
].join(", ");

async function getIncidentRecord(
  userId: string,
  incidentId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  return requireResourceAccess(userId, "incident", incidentId, organizationId, adminClient);
}

async function getExternalIssueRecord(
  organizationId: string,
  externalIssueId: string,
  adminClient: AdminLike,
) {
  const { data, error } = await adminClient
    .from("external_issues")
    .select(EXTERNAL_ISSUE_SELECT)
    .eq("id", externalIssueId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw mapPostgresError(error);
  }

  if (!data) {
    throw new ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.");
  }

  return mapExternalIssueRow(toExternalIssueLookupRow(data));
}

function sanitizeExternalIssueInput(input: CreateExternalIssueReferenceInput) {
  const externalId = sanitizeExternalIssueIdentifier(input.externalId);

  if (!externalId) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed.", {
      issues: {
        fieldErrors: {
          externalId: ["External issue id is required."],
        },
        formErrors: [],
      },
    });
  }

  return {
    sourceKind: sanitizeExternalIssueSourceKind(input.sourceKind),
    externalId,
    externalKey: sanitizeExternalIssueKey(input.externalKey),
    title: sanitizeExternalIssueTitle(input.title),
    status: sanitizeExternalIssueStatus(input.status),
    priority: sanitizeExternalIssuePriority(input.priority),
    sourceUrl: sanitizeExternalIssueUrl(input.sourceUrl),
    customerReference: sanitizeExternalIssueCustomerReference(input.customerReference),
    summary: sanitizeExternalIssueSummary(input.summary),
  };
}

export async function upsertExternalIssueReference(
  context: ExternalIssueServiceContext,
  input: CreateExternalIssueReferenceInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeExternalIssue> {
  await requireOrgMembership(context.userId, context.organization.id, adminClient);

  const sanitized = sanitizeExternalIssueInput(input);
  const { data: existing, error: lookupError } = await adminClient
    .from("external_issues")
    .select(EXTERNAL_ISSUE_SELECT)
    .eq("organization_id", context.organization.id)
    .eq("source_kind", sanitized.sourceKind)
    .eq("external_id", sanitized.externalId)
    .maybeSingle();

  if (lookupError) {
    throw mapPostgresError(lookupError);
  }

  if (existing) {
    const existingRow = mapExternalIssueRow(toExternalIssueLookupRow(existing));
    const patch = {
      external_key: sanitized.externalKey,
      title: sanitized.title,
      status: sanitized.status,
      priority: sanitized.priority,
      source_url: sanitized.sourceUrl,
      customer_reference: sanitized.customerReference,
      summary: sanitized.summary,
    };

    const { data, error } = await adminClient
      .from("external_issues")
      .update(patch)
      .eq("id", existingRow.id)
      .eq("organization_id", context.organization.id)
      .select(EXTERNAL_ISSUE_SELECT)
      .single();

    if (error) {
      throw mapPostgresError(error);
    }

    const raw = mapExternalIssueRow(toExternalIssueLookupRow(data));

    await writeAuditLog({
      organizationId: context.organization.id,
      actorType: "user",
      actorUserId: context.userId,
      actionType: "update",
      targetTable: "external_issues",
      targetId: raw.id,
      metadata: {
        before: sanitizeExternalIssueForAudit(existingRow),
        after: sanitizeExternalIssueForAudit(raw),
      },
      request: context.request,
    });

    return toSafeExternalIssue(raw);
  }

  const { data, error } = await adminClient
    .from("external_issues")
    .insert({
      organization_id: context.organization.id,
      source_kind: sanitized.sourceKind,
      external_id: sanitized.externalId,
      external_key: sanitized.externalKey,
      title: sanitized.title,
      status: sanitized.status,
      priority: sanitized.priority,
      source_url: sanitized.sourceUrl,
      customer_reference: sanitized.customerReference,
      summary: sanitized.summary,
      created_by: context.userId,
    })
    .select(EXTERNAL_ISSUE_SELECT)
    .single();

  if (error) {
    throw mapPostgresError(error);
  }

  const raw = mapExternalIssueRow(toExternalIssueLookupRow(data));

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "create",
    targetTable: "external_issues",
    targetId: raw.id,
    metadata: {
      record: sanitizeExternalIssueForAudit(raw),
    },
    request: context.request,
  });

  return toSafeExternalIssue(raw);
}

export async function linkExternalIssueToIncident(
  context: ExternalIssueServiceContext,
  incidentId: string,
  externalIssueId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeExternalIssue[]> {
  const { resource: incident } = await getIncidentRecord(
    context.userId,
    incidentId,
    context.organization.id,
    adminClient,
  );
  const externalIssue = await getExternalIssueRecord(context.organization.id, externalIssueId, adminClient);

  const { error } = await adminClient.from("incident_external_issues").upsert(
    {
      organization_id: context.organization.id,
      incident_id: incident.id,
      external_issue_id: externalIssue.id,
      linked_by: context.userId,
    },
    {
      onConflict: "organization_id,incident_id,external_issue_id",
      ignoreDuplicates: true,
    },
  );

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "incident_external_issues",
    targetId: incident.id,
    metadata: {
      incidentId: incident.id,
      externalIssue: sanitizeExternalIssueForAudit(externalIssue),
      action: "link",
    },
    request: context.request,
  });

  return listLinkedExternalIssuesForIncident(
    context.userId,
    incident.id,
    context.organization.id,
    adminClient,
  );
}

export async function createAndLinkExternalIssueReference(
  context: ExternalIssueServiceContext,
  incidentId: string,
  input: CreateExternalIssueReferenceInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeExternalIssue[]> {
  const externalIssue = await upsertExternalIssueReference(context, input, adminClient);

  return linkExternalIssueToIncident(context, incidentId, externalIssue.id, adminClient);
}

export async function unlinkExternalIssueFromIncident(
  context: ExternalIssueServiceContext,
  incidentId: string,
  externalIssueId: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeExternalIssue[]> {
  const { resource: incident } = await getIncidentRecord(
    context.userId,
    incidentId,
    context.organization.id,
    adminClient,
  );
  const externalIssue = await getExternalIssueRecord(context.organization.id, externalIssueId, adminClient);

  const { error } = await adminClient
    .from("incident_external_issues")
    .delete()
    .eq("organization_id", context.organization.id)
    .eq("incident_id", incident.id)
    .eq("external_issue_id", externalIssue.id);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "delete",
    targetTable: "incident_external_issues",
    targetId: incident.id,
    metadata: {
      incidentId: incident.id,
      externalIssue: sanitizeExternalIssueForAudit(externalIssue),
      action: "unlink",
    },
    request: context.request,
  });

  return listLinkedExternalIssuesForIncident(
    context.userId,
    incident.id,
    context.organization.id,
    adminClient,
  );
}

export async function listLinkedExternalIssuesForIncident(
  userId: string,
  incidentId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeExternalIssue[]> {
  const { resource: incident } = await getIncidentRecord(userId, incidentId, organizationId, adminClient);

  const { data: links, error: linksError } = await adminClient
    .from("incident_external_issues")
    .select("external_issue_id, created_at")
    .eq("organization_id", incident.organization_id)
    .eq("incident_id", incident.id)
    .order("created_at", { ascending: false });

  if (linksError) {
    throw mapPostgresError(linksError);
  }

  const linkRows = (links ?? []) as Array<{ external_issue_id: string; created_at: string }>;

  if (linkRows.length === 0) {
    return [];
  }

  const issueIds = linkRows.map((row) => row.external_issue_id);
  const linkedAtMap = new Map(linkRows.map((row) => [row.external_issue_id, row.created_at]));

  const { data: issues, error: issuesError } = await adminClient
    .from("external_issues")
    .select(EXTERNAL_ISSUE_SELECT)
    .eq("organization_id", incident.organization_id)
    .in("id", issueIds);

  if (issuesError) {
    throw mapPostgresError(issuesError);
  }

  const issueMap = new Map(
    ((issues ?? []) as unknown[]).map((row) => {
      const issue = mapExternalIssueRow(toExternalIssueLookupRow(row));
      return [issue.id, issue] as const;
    }),
  );

  return issueIds.flatMap((issueId) => {
    const issue = issueMap.get(issueId);

    if (!issue) {
      return [];
    }

    return [
      toSafeExternalIssue({
        ...issue,
        linkedAt: linkedAtMap.get(issueId) ?? null,
      }),
    ];
  });
}

export async function updateIncidentCustomerImpact(
  context: ExternalIssueServiceContext,
  incidentId: string,
  input: UpdateIncidentCustomerImpactInput,
  adminClient: AdminLike = createSupabaseAdminClient(),
) {
  const { resource: incident } = await getIncidentRecord(
    context.userId,
    incidentId,
    context.organization.id,
    adminClient,
  );

  const customerImpactSummary = sanitizeIncidentText(input.customerImpactSummary);
  const customerImpactNotes = sanitizeIncidentText(input.customerImpactNotes);

  const { error } = await adminClient
    .from("incidents")
    .update({
      customer_impact_summary: customerImpactSummary,
      customer_impact_notes: customerImpactNotes,
    })
    .eq("id", incident.id)
    .eq("organization_id", context.organization.id);

  if (error) {
    throw mapPostgresError(error);
  }

  await writeAuditLog({
    organizationId: context.organization.id,
    actorType: "user",
    actorUserId: context.userId,
    actionType: "update",
    targetTable: "incidents",
    targetId: incident.id,
    metadata: {
      customerImpactSummary,
      customerImpactNotes,
      action: "update_customer_impact",
    },
    request: context.request,
  });
}

export async function listSuggestedExternalIssuesForIncident(
  userId: string,
  incidentId: string,
  organizationId?: string,
  adminClient: AdminLike = createSupabaseAdminClient(),
): Promise<SafeExternalIssue[]> {
  const { resource: incident } = await getIncidentRecord(userId, incidentId, organizationId, adminClient);

  const { data: linkedRows, error: linkedError } = await adminClient
    .from("incident_external_issues")
    .select("external_issue_id")
    .eq("organization_id", incident.organization_id)
    .eq("incident_id", incident.id);

  if (linkedError) {
    throw mapPostgresError(linkedError);
  }

  const linkedIds = new Set(
    (linkedRows ?? []).map((row) => String((row as Record<string, unknown>).external_issue_id)),
  );

  const { data, error } = await adminClient
    .from("external_issues")
    .select(EXTERNAL_ISSUE_SELECT)
    .eq("organization_id", incident.organization_id)
    .eq("source_kind", "ciex")
    .eq("related_app_id", incident.app_id)
    .order("last_synced_at", { ascending: false })
    .limit(25);

  if (error) {
    throw mapPostgresError(error);
  }

  return ((data ?? []) as unknown[])
    .map((row) => mapExternalIssueRow(toExternalIssueLookupRow(row)))
    .filter((issue) => {
      if (linkedIds.has(issue.id)) {
        return false;
      }

      if (issue.relatedMonitorId) {
        return issue.relatedMonitorId === ((incident.monitor_id as string | null) ?? null);
      }

      if (issue.relatedEnvironmentId) {
        return issue.relatedEnvironmentId === ((incident.environment_id as string | null) ?? null);
      }

      return issue.relatedAppId === ((incident.app_id as string | null) ?? null);
    })
    .slice(0, 10)
    .map((issue) => toSafeExternalIssue(issue));
}
