create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  app_id uuid,
  monitor_id uuid,
  name text not null,
  is_enabled boolean not null default true,
  severity_filter public.severity[],
  send_recovery boolean not null default true,
  notify_on_degraded boolean not null default true,
  dedupe_window_seconds integer not null default 1800,
  max_retry_attempts integer not null default 5,
  backoff_strategy text not null default 'exponential',
  configuration jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint alert_rules_org_id_id_key unique (organization_id, id),
  constraint alert_rules_retry_positive check (max_retry_attempts >= 0),
  constraint alert_rules_dedupe_positive check (dedupe_window_seconds >= 0),
  constraint alert_rules_org_app_fk foreign key (organization_id, app_id)
    references public.monitored_apps (organization_id, id) on delete cascade,
  constraint alert_rules_org_monitor_fk foreign key (organization_id, monitor_id)
    references public.monitors (organization_id, id) on delete cascade
);

create table public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  type public.notification_channel_type not null,
  is_enabled boolean not null default true,
  masked_destination text,
  encrypted_config text,
  last_tested_at timestamptz,
  last_test_status public.alert_delivery_status,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint notification_channels_org_id_id_key unique (organization_id, id)
);

comment on column public.notification_channels.encrypted_config is 'Encrypted Slack webhook configuration only. Email remains structural and is not implemented in this pass.';

create table public.alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  incident_id uuid,
  monitor_id uuid,
  alert_rule_id uuid,
  notification_channel_id uuid not null,
  event_type text not null,
  dedupe_key text not null,
  status public.alert_delivery_status not null default 'pending',
  severity public.severity not null,
  scheduled_for timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  next_retry_at timestamptz,
  final_error text,
  provider_response jsonb not null default '{}'::jsonb,
  suppressed_by_maintenance_window_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  constraint alert_deliveries_org_id_id_key unique (organization_id, id),
  constraint alert_deliveries_org_incident_fk foreign key (organization_id, incident_id)
    references public.incidents (organization_id, id) on delete set null,
  constraint alert_deliveries_org_monitor_fk foreign key (organization_id, monitor_id)
    references public.monitors (organization_id, id) on delete set null,
  constraint alert_deliveries_org_rule_fk foreign key (organization_id, alert_rule_id)
    references public.alert_rules (organization_id, id) on delete set null,
  constraint alert_deliveries_org_channel_fk foreign key (organization_id, notification_channel_id)
    references public.notification_channels (organization_id, id) on delete cascade
);

create table public.alert_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  alert_delivery_id uuid not null,
  attempt_number integer not null,
  attempted_at timestamptz not null default timezone('utc', now()),
  status public.alert_delivery_status not null,
  duration_ms integer,
  error_code text,
  error_message text,
  provider_response jsonb not null default '{}'::jsonb,
  constraint alert_delivery_attempts_attempt_positive check (attempt_number > 0),
  constraint alert_delivery_attempts_org_delivery_fk foreign key (organization_id, alert_delivery_id)
    references public.alert_deliveries (organization_id, id) on delete cascade,
  constraint alert_delivery_attempts_unique_attempt unique (alert_delivery_id, attempt_number)
);

create index alert_rules_org_enabled_idx on public.alert_rules (organization_id, is_enabled);
create unique index alert_deliveries_dedupe_idx
  on public.alert_deliveries (organization_id, notification_channel_id, dedupe_key);
create index alert_deliveries_retry_lookup_idx on public.alert_deliveries (status, next_retry_at);
create index alert_deliveries_incident_created_idx on public.alert_deliveries (incident_id, created_at desc);
create index alert_delivery_attempts_delivery_idx on public.alert_delivery_attempts (alert_delivery_id, attempted_at desc);

create trigger alert_rules_touch_updated_at
before update on public.alert_rules
for each row
execute function public.touch_updated_at();

create trigger notification_channels_touch_updated_at
before update on public.notification_channels
for each row
execute function public.touch_updated_at();
