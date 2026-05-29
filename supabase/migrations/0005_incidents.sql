create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  app_id uuid not null,
  environment_id uuid,
  monitor_id uuid not null,
  created_from_result_id uuid,
  title text not null,
  summary text,
  severity public.severity not null,
  status public.incident_status not null default 'detected',
  dedupe_key text not null,
  assigned_to uuid references auth.users (id) on delete set null,
  opened_by uuid references auth.users (id) on delete set null,
  detected_at timestamptz not null default timezone('utc', now()),
  opened_at timestamptz,
  acknowledged_at timestamptz,
  recovered_at timestamptz,
  resolved_at timestamptz,
  auto_resolve_on_recovery boolean not null default false,
  root_cause text,
  resolution_notes text,
  last_state_change_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint incidents_org_id_id_key unique (organization_id, id),
  constraint incidents_org_monitor_fk foreign key (organization_id, monitor_id)
    references public.monitors (organization_id, id) on delete cascade,
  constraint incidents_org_result_fk foreign key (organization_id, created_from_result_id)
    references public.monitor_results (organization_id, id) on delete set null,
  constraint incidents_org_app_fk foreign key (organization_id, app_id)
    references public.monitored_apps (organization_id, id) on delete cascade,
  constraint incidents_org_environment_fk foreign key (organization_id, environment_id)
    references public.app_environments (organization_id, id) on delete set null
);

create table public.incident_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  incident_id uuid not null,
  actor_type text not null check (actor_type in ('user', 'system', 'heartbeat')),
  actor_user_id uuid references auth.users (id) on delete set null,
  status_from public.incident_status,
  status_to public.incident_status,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint incident_updates_org_incident_fk foreign key (organization_id, incident_id)
    references public.incidents (organization_id, id) on delete cascade
);

create unique index incidents_unresolved_dedupe_idx
  on public.incidents (organization_id, monitor_id, dedupe_key)
  where status <> 'resolved';

create index incidents_org_status_severity_idx on public.incidents (organization_id, status, severity);
create index incidents_monitor_status_idx on public.incidents (monitor_id, status);
create index incident_updates_incident_created_idx on public.incident_updates (incident_id, created_at);

create trigger incidents_touch_updated_at
before update on public.incidents
for each row
execute function public.touch_updated_at();

comment on index incidents_unresolved_dedupe_idx is 'Prevents duplicate unresolved incidents for the same monitor and dedupe key.';
