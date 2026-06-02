alter table public.integrations
  add column inbound_key_hash text,
  add column inbound_key_hint text,
  add column last_inbound_at timestamptz;

create unique index integrations_inbound_key_hash_key
  on public.integrations (inbound_key_hash)
  where inbound_key_hash is not null;

alter table public.external_issues
  add column first_seen_at timestamptz not null default timezone('utc', now()),
  add column last_synced_at timestamptz not null default timezone('utc', now()),
  add column source_created_at timestamptz,
  add column source_updated_at timestamptz,
  add column related_app_id uuid,
  add column related_environment_id uuid,
  add column related_monitor_id uuid,
  add constraint external_issues_related_app_fk foreign key (organization_id, related_app_id)
    references public.monitored_apps (organization_id, id) on delete set null,
  add constraint external_issues_related_environment_fk foreign key (organization_id, related_environment_id)
    references public.app_environments (organization_id, id) on delete set null,
  add constraint external_issues_related_monitor_fk foreign key (organization_id, related_monitor_id)
    references public.monitors (organization_id, id) on delete set null;

drop index if exists public.external_issues_org_source_external_id_key;

create unique index external_issues_org_source_external_id_key
  on public.external_issues (organization_id, source_kind, external_id)
  where integration_id is null;

create unique index external_issues_org_integration_external_id_key
  on public.external_issues (organization_id, integration_id, external_id)
  where integration_id is not null;

create index external_issues_org_ciex_related_lookup_idx
  on public.external_issues (
    organization_id,
    source_kind,
    related_app_id,
    related_environment_id,
    related_monitor_id,
    last_synced_at desc
  );

comment on column public.integrations.inbound_key_hash is 'SHA-256 hash of the inbound shared secret for webhook/API ingestion. Never store the raw secret.';
comment on column public.integrations.inbound_key_hint is 'Short non-secret hint for identifying the active inbound secret during manual provisioning.';
comment on column public.integrations.last_inbound_at is 'Last successful inbound event timestamp for the integration.';
comment on column public.external_issues.first_seen_at is 'First time the normalized external issue was ingested into Prod Pulse.';
comment on column public.external_issues.last_synced_at is 'Last time the normalized external issue was updated from an inbound source.';
comment on column public.external_issues.source_created_at is 'Optional upstream ticket creation timestamp from the external system.';
comment on column public.external_issues.source_updated_at is 'Optional upstream ticket update timestamp from the external system.';
comment on column public.external_issues.related_app_id is 'Optional internal app reference supplied by a trusted integration for deterministic incident suggestions.';
comment on column public.external_issues.related_environment_id is 'Optional internal environment reference supplied by a trusted integration for deterministic incident suggestions.';
comment on column public.external_issues.related_monitor_id is 'Optional internal monitor reference supplied by a trusted integration for deterministic incident suggestions.';
