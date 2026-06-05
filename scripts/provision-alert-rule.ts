const { createClient } = require("@supabase/supabase-js");

type Severity = "info" | "warning" | "critical" | "emergency";
type AlertEventType =
  | "incident_created"
  | "incident_updated"
  | "incident_recovered"
  | "incident_resolved";

type ProvisioningInput = {
  organizationId: string;
  appId: string;
  monitorId: string;
  channelId: string;
  ruleName: string;
};

const DEFAULT_EVENT_TYPES: AlertEventType[] = [
  "incident_created",
  "incident_recovered",
  "incident_resolved",
];
const DEFAULT_SEVERITY_FILTER: Severity[] = ["warning", "critical", "emergency"];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readProvisioningInput(): ProvisioningInput {
  const organizationId = readRequiredEnv("ORG_ID");
  const appId = readRequiredEnv("APP_ID");
  const monitorId = readRequiredEnv("MONITOR_ID");
  const channelId = readRequiredEnv("CHANNEL_ID");
  const ruleName = readRequiredEnv("RULE_NAME");

  for (const [label, value] of [
    ["ORG_ID", organizationId],
    ["APP_ID", appId],
    ["MONITOR_ID", monitorId],
    ["CHANNEL_ID", channelId],
  ] as const) {
    if (!UUID_PATTERN.test(value)) {
      throw new Error(`${label} must be a UUID.`);
    }
  }

  return {
    organizationId,
    appId,
    monitorId,
    channelId,
    ruleName,
  };
}

function createAdminClient() {
  const url = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function toSeverityFilterLiteral(values: Severity[]) {
  return `{${values.join(",")}}`;
}

async function ensureRowExists(
  adminClient: ReturnType<typeof createAdminClient>,
  table: "monitored_apps" | "monitors" | "notification_channels",
  id: string,
  organizationId: string,
) {
  const { data, error } = await adminClient
    .from(table)
    .select(table === "monitors" ? "id, organization_id, app_id, name" : "id, organization_id, name")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`${table} lookup failed: ${error.message}`);
  }

  if (!data) {
    throw new Error(`${table} ${id} was not found in organization ${organizationId}.`);
  }

  return data;
}

async function run() {
  const input = readProvisioningInput();
  const adminClient = createAdminClient();

  const existing = await adminClient
    .from("alert_rules")
    .select("id, organization_id, monitor_id, name")
    .eq("organization_id", input.organizationId)
    .eq("monitor_id", input.monitorId)
    .eq("name", input.ruleName)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`alert_rules lookup failed: ${existing.error.message}`);
  }

  if (existing.data) {
    console.log(JSON.stringify({ status: "existing", ruleId: existing.data.id }));
    return;
  }

  const app = await ensureRowExists(
    adminClient,
    "monitored_apps",
    input.appId,
    input.organizationId,
  );
  const monitor = await ensureRowExists(
    adminClient,
    "monitors",
    input.monitorId,
    input.organizationId,
  );
  await ensureRowExists(
    adminClient,
    "notification_channels",
    input.channelId,
    input.organizationId,
  );

  if ("app_id" in monitor && monitor.app_id !== app.id) {
    throw new Error("Selected monitor does not belong to the selected app.");
  }

  const { data, error } = await adminClient
    .from("alert_rules")
    .insert({
      organization_id: input.organizationId,
      app_id: input.appId,
      monitor_id: input.monitorId,
      name: input.ruleName,
      is_enabled: true,
      severity_filter: toSeverityFilterLiteral(DEFAULT_SEVERITY_FILTER),
      send_recovery: true,
      notify_on_degraded: true,
      dedupe_window_seconds: 120,
      max_retry_attempts: 5,
      backoff_strategy: "exponential",
      configuration: {
        eventTypes: DEFAULT_EVENT_TYPES,
        notificationChannelIds: [input.channelId],
      },
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`alert_rules insert failed: ${error.message}`);
  }

  console.log(JSON.stringify({ status: "created", ruleId: data.id }));
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "error", message }));
  process.exit(1);
});
