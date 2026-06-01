alter table public.heartbeats
  add column if not exists is_enabled boolean not null default true;

comment on column public.heartbeats.is_enabled is
  'Disabled heartbeats reject ingestion and are skipped by freshness evaluation.';

create unique index if not exists heartbeats_token_hash_key
  on public.heartbeats (token_hash);

create unique index if not exists heartbeats_monitor_id_unique_idx
  on public.heartbeats (monitor_id)
  where monitor_id is not null;

alter table public.heartbeats
  add constraint heartbeats_org_monitor_fk foreign key (organization_id, monitor_id)
    references public.monitors (organization_id, id) on delete set null;

comment on constraint heartbeats_org_monitor_fk on public.heartbeats is
  'Org-scoped monitor linkage prevents cross-organization heartbeat associations.';
