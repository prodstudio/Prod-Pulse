create table public.monitored_apps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  owner_team text,
  status public.app_status not null default 'unknown',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitored_apps_org_slug_key unique (organization_id, slug),
  constraint monitored_apps_org_id_id_key unique (organization_id, id)
);

create table public.app_environments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  app_id uuid not null,
  name text not null,
  slug text not null,
  type public.environment_type not null,
  base_url text,
  status public.app_status not null default 'unknown',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint app_environments_app_name_key unique (app_id, name),
  constraint app_environments_org_slug_key unique (organization_id, slug),
  constraint app_environments_org_app_fk foreign key (organization_id, app_id)
    references public.monitored_apps (organization_id, id) on delete cascade,
  constraint app_environments_org_id_id_key unique (organization_id, id)
);

create index monitored_apps_org_status_idx on public.monitored_apps (organization_id, status);
create index app_environments_org_app_idx on public.app_environments (organization_id, app_id);
create index app_environments_org_status_idx on public.app_environments (organization_id, status);

create trigger monitored_apps_touch_updated_at
before update on public.monitored_apps
for each row
execute function public.touch_updated_at();

create trigger app_environments_touch_updated_at
before update on public.app_environments
for each row
execute function public.touch_updated_at();

comment on column public.app_environments.base_url is 'Used later by monitors and internal status previews. Do not store credentials in URLs.';
