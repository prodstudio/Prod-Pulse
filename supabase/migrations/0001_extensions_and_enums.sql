create extension if not exists pgcrypto;

comment on extension pgcrypto is 'Provides gen_random_uuid() and crypto primitives used by Prod Pulse.';

create type public.org_role as enum ('owner', 'admin', 'responder', 'viewer');
create type public.app_status as enum ('operational', 'degraded', 'down', 'maintenance', 'unknown');
create type public.environment_type as enum ('production', 'staging', 'preview', 'development', 'other');
create type public.monitor_type as enum (
  'http_uptime',
  'api_health_endpoint',
  'json_assertion',
  'latency_threshold',
  'ssl_expiry',
  'heartbeat_freshness'
);
create type public.monitor_status as enum (
  'operational',
  'degraded',
  'down',
  'paused',
  'maintenance',
  'unknown'
);
create type public.monitor_result_status as enum (
  'success',
  'degraded',
  'failure',
  'timeout',
  'error',
  'skipped',
  'suppressed'
);
create type public.incident_status as enum (
  'detected',
  'open',
  'acknowledged',
  'investigating',
  'monitoring',
  'resolved'
);
create type public.severity as enum ('info', 'warning', 'critical', 'emergency');
create type public.notification_channel_type as enum ('slack', 'email', 'whatsapp');
create type public.alert_delivery_status as enum (
  'pending',
  'sending',
  'sent',
  'failed',
  'retrying',
  'suppressed'
);
create type public.maintenance_scope as enum ('organization', 'app', 'environment', 'monitor');
create type public.audit_action_type as enum (
  'create',
  'update',
  'delete',
  'rotate_secret',
  'test',
  'run',
  'acknowledge',
  'assign',
  'resolve',
  'recover',
  'suppress',
  'publish',
  'unpublish',
  'system'
);

comment on type public.monitor_type is 'Manual execution is modeled as a monitor result trigger, not as a distinct monitor type.';
comment on type public.monitor_result_status is 'Stores persisted outcomes for scheduled, manual, retry, and heartbeat-driven executions.';
comment on type public.notification_channel_type is 'Slack is the only provider implemented first; email and WhatsApp remain reserved structurally.';

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

comment on function public.touch_updated_at() is 'Shared trigger to keep updated_at current on mutable application tables.';
