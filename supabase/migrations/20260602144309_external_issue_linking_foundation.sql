alter table public.integrations
  add constraint integrations_org_id_id_key unique (organization_id, id);

alter table public.incidents
  add column customer_impact_summary text,
  add column customer_impact_notes text;

create table public.external_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid,
  source_kind text not null,
  external_id text not null,
  external_key text,
  title text not null,
  status text,
  priority text,
  source_url text,
  customer_reference text,
  summary text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint external_issues_org_id_id_key unique (organization_id, id),
  constraint external_issues_org_integration_fk foreign key (organization_id, integration_id)
    references public.integrations (organization_id, id) on delete set null,
  constraint external_issues_source_kind_format check (source_kind ~ '^[a-z0-9_]+$')
);

create table public.incident_external_issues (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  incident_id uuid not null,
  external_issue_id uuid not null,
  linked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint incident_external_issues_pkey primary key (organization_id, incident_id, external_issue_id),
  constraint incident_external_issues_incident_fk foreign key (organization_id, incident_id)
    references public.incidents (organization_id, id) on delete cascade,
  constraint incident_external_issues_external_issue_fk foreign key (organization_id, external_issue_id)
    references public.external_issues (organization_id, id) on delete cascade
);

create unique index external_issues_org_source_external_id_key
  on public.external_issues (organization_id, source_kind, external_id);

create index external_issues_org_created_idx
  on public.external_issues (organization_id, created_at desc);

create index incident_external_issues_issue_lookup_idx
  on public.incident_external_issues (organization_id, external_issue_id, created_at desc);

create trigger external_issues_touch_updated_at
before update on public.external_issues
for each row
execute function public.touch_updated_at();

comment on table public.external_issues is 'Normalized external issue references for manual linkage. Do not store raw CIEX payloads or secrets here.';
comment on table public.incident_external_issues is 'Org-scoped links between incidents and sanitized external issue references.';
comment on column public.incidents.customer_impact_summary is 'Short sanitized internal summary of customer-facing impact.';
comment on column public.incidents.customer_impact_notes is 'Sanitized internal notes about impacted customers, accounts, or support signals.';
