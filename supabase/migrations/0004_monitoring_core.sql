create table public.runner_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  actor_type text not null default 'system' check (actor_type in ('user', 'system', 'heartbeat')),
  trigger_source text not null default 'vercel_cron',
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  total_monitors_selected integer not null default 0,
  total_monitors_processed integer not null default 0,
  total_monitors_failed integer not null default 0,
  total_monitors_skipped integer not null default 0,
  failure_summary jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.runner_runs is 'Server-owned execution log for scheduled monitor batches. Not intended for direct client mutation.';

create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  app_id uuid not null,
  environment_id uuid,
  name text not null,
  slug text not null,
  type public.monitor_type not null,
  status public.monitor_status not null default 'unknown',
  is_enabled boolean not null default true,
  description text,
  request_method text not null default 'GET',
  target_url text,
  expected_status_codes integer[] not null default array[200],
  timeout_ms integer not null default 10000,
  interval_seconds integer not null default 300,
  latency_threshold_ms integer,
  consecutive_failure_threshold integer not null default 3,
  consecutive_recovery_threshold integer not null default 2,
  consecutive_failures integer not null default 0,
  consecutive_successes integer not null default 0,
  configuration jsonb not null default '{}'::jsonb,
  encrypted_headers text,
  next_check_at timestamptz,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_scheduled_bucket timestamptz,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  locked_by_run_id uuid references public.runner_runs (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitors_org_slug_key unique (organization_id, slug),
  constraint monitors_org_id_id_key unique (organization_id, id),
  constraint monitors_org_app_fk foreign key (organization_id, app_id)
    references public.monitored_apps (organization_id, id) on delete cascade,
  constraint monitors_org_environment_fk foreign key (organization_id, environment_id)
    references public.app_environments (organization_id, id) on delete set null,
  constraint monitors_timeout_positive check (timeout_ms > 0),
  constraint monitors_interval_positive check (interval_seconds > 0),
  constraint monitors_failure_threshold_positive check (consecutive_failure_threshold > 0),
  constraint monitors_recovery_threshold_positive check (consecutive_recovery_threshold > 0),
  constraint monitors_method_uppercase check (request_method = upper(request_method))
);

comment on column public.monitors.encrypted_headers is 'Encrypted request headers only. Never expose via normal member-scoped selects.';

create table public.monitor_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  monitor_id uuid not null,
  app_id uuid not null,
  environment_id uuid,
  runner_run_id uuid references public.runner_runs (id) on delete set null,
  trigger_source text not null check (trigger_source in ('scheduled', 'manual', 'heartbeat', 'retry')),
  status public.monitor_result_status not null,
  idempotency_key text,
  checked_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  duration_ms integer,
  http_status integer,
  error_code text,
  error_message text,
  response_excerpt text,
  assertion_results jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  suppressed_by_maintenance_window_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  constraint monitor_results_org_id_id_key unique (organization_id, id),
  constraint monitor_results_org_monitor_fk foreign key (organization_id, monitor_id)
    references public.monitors (organization_id, id) on delete cascade,
  constraint monitor_results_org_app_fk foreign key (organization_id, app_id)
    references public.monitored_apps (organization_id, id) on delete cascade,
  constraint monitor_results_org_environment_fk foreign key (organization_id, environment_id)
    references public.app_environments (organization_id, id) on delete set null
);

comment on table public.monitor_results is 'Append-only operational evidence. Raw payloads should stay shallow and safe to store.';

create table public.monitor_result_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  monitor_result_id uuid not null,
  attempt_number integer not null,
  status public.monitor_result_status not null,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  duration_ms integer,
  http_status integer,
  error_code text,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint monitor_result_attempts_attempt_positive check (attempt_number > 0),
  constraint monitor_result_attempts_org_result_fk foreign key (organization_id, monitor_result_id)
    references public.monitor_results (organization_id, id) on delete cascade,
  constraint monitor_result_attempts_unique_attempt unique (monitor_result_id, attempt_number)
);

create table public.heartbeats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  app_id uuid not null,
  environment_id uuid,
  monitor_id uuid references public.monitors (id) on delete set null,
  name text not null,
  slug text not null,
  expected_interval_seconds integer not null,
  grace_seconds integer not null default 300,
  token_hash text not null,
  token_hint text,
  status public.monitor_status not null default 'unknown',
  last_seen_at timestamptz,
  last_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint heartbeats_org_slug_key unique (organization_id, slug),
  constraint heartbeats_expected_interval_positive check (expected_interval_seconds > 0),
  constraint heartbeats_grace_seconds_positive check (grace_seconds >= 0),
  constraint heartbeats_org_app_fk foreign key (organization_id, app_id)
    references public.monitored_apps (organization_id, id) on delete cascade,
  constraint heartbeats_org_environment_fk foreign key (organization_id, environment_id)
    references public.app_environments (organization_id, id) on delete set null
);

comment on column public.heartbeats.token_hash is 'Heartbeat tokens must be hashable at rest. Raw tokens are never persisted.';

create index monitors_due_selection_idx on public.monitors (is_enabled, next_check_at);
create index monitors_org_due_selection_idx on public.monitors (organization_id, next_check_at);
create index monitors_lock_recovery_idx on public.monitors (lock_expires_at);
create index monitor_results_monitor_checked_idx on public.monitor_results (monitor_id, checked_at desc);
create index monitor_results_org_checked_idx on public.monitor_results (organization_id, checked_at desc);
create index monitor_results_app_checked_idx on public.monitor_results (app_id, checked_at desc);
create unique index monitor_results_idempotency_key_idx
  on public.monitor_results (organization_id, idempotency_key)
  where idempotency_key is not null;
create index heartbeats_last_seen_idx on public.heartbeats (organization_id, last_seen_at);

create trigger monitors_touch_updated_at
before update on public.monitors
for each row
execute function public.touch_updated_at();

create trigger heartbeats_touch_updated_at
before update on public.heartbeats
for each row
execute function public.touch_updated_at();
