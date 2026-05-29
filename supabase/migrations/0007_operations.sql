create table public.maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scope public.maintenance_scope not null,
  app_id uuid,
  environment_id uuid,
  monitor_id uuid,
  title text not null,
  description text,
  suppress_alerts boolean not null default true,
  suppress_incident_transitions boolean not null default true,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint maintenance_windows_org_id_id_key unique (organization_id, id),
  constraint maintenance_windows_valid_range check (ends_at > starts_at),
  constraint maintenance_windows_org_app_fk foreign key (organization_id, app_id)
    references public.monitored_apps (organization_id, id) on delete cascade,
  constraint maintenance_windows_org_environment_fk foreign key (organization_id, environment_id)
    references public.app_environments (organization_id, id) on delete set null,
  constraint maintenance_windows_org_monitor_fk foreign key (organization_id, monitor_id)
    references public.monitors (organization_id, id) on delete cascade
);

create table public.status_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  is_public boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint status_pages_org_id_id_key unique (organization_id, id),
  constraint status_pages_org_slug_key unique (organization_id, slug)
);

comment on column public.status_pages.is_public is 'Reserved for future expansion. MVP status pages are internal preview only.';

create table public.status_page_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status_page_id uuid not null,
  monitored_app_id uuid,
  environment_id uuid,
  monitor_id uuid,
  display_name text not null,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint status_page_components_target_present check (
    monitored_app_id is not null
    or environment_id is not null
    or monitor_id is not null
  ),
  constraint status_page_components_org_page_fk foreign key (organization_id, status_page_id)
    references public.status_pages (organization_id, id) on delete cascade,
  constraint status_page_components_org_app_fk foreign key (organization_id, monitored_app_id)
    references public.monitored_apps (organization_id, id) on delete cascade,
  constraint status_page_components_org_environment_fk foreign key (organization_id, environment_id)
    references public.app_environments (organization_id, id) on delete set null,
  constraint status_page_components_org_monitor_fk foreign key (organization_id, monitor_id)
    references public.monitors (organization_id, id) on delete cascade
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  name text not null,
  is_enabled boolean not null default true,
  encrypted_config text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.integrations is 'Placeholder integration registry for future observability providers. Do not expose encrypted_config via normal selects.';

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'system', 'heartbeat')),
  actor_user_id uuid references auth.users (id) on delete set null,
  action_type public.audit_action_type not null,
  target_table text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.audit_logs is 'Audit metadata only. Never write secrets, raw Slack webhooks, or plaintext heartbeat tokens here.';

create index maintenance_windows_scope_lookup_idx
  on public.maintenance_windows (organization_id, scope, starts_at, ends_at);
create index status_page_components_page_sort_idx
  on public.status_page_components (status_page_id, sort_order);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_table, target_id);

create trigger maintenance_windows_touch_updated_at
before update on public.maintenance_windows
for each row
execute function public.touch_updated_at();

create trigger status_pages_touch_updated_at
before update on public.status_pages
for each row
execute function public.touch_updated_at();

create trigger status_page_components_touch_updated_at
before update on public.status_page_components
for each row
execute function public.touch_updated_at();

create trigger integrations_touch_updated_at
before update on public.integrations
for each row
execute function public.touch_updated_at();

alter table public.monitor_results
  add constraint monitor_results_suppressed_window_fk
  foreign key (organization_id, suppressed_by_maintenance_window_id)
  references public.maintenance_windows (organization_id, id)
  on delete set null;

alter table public.alert_deliveries
  add constraint alert_deliveries_suppressed_window_fk
  foreign key (organization_id, suppressed_by_maintenance_window_id)
  references public.maintenance_windows (organization_id, id)
  on delete set null;
