create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint organizations_slug_key unique (slug)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null,
  disabled_at timestamptz,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint memberships_organization_user_key unique (organization_id, user_id)
);

create index memberships_user_org_idx on public.memberships (user_id, organization_id);
create index memberships_org_role_idx on public.memberships (organization_id, role);

create trigger organizations_touch_updated_at
before update on public.organizations
for each row
execute function public.touch_updated_at();

create trigger profiles_touch_updated_at
before update on public.profiles
for each row
execute function public.touch_updated_at();

create trigger memberships_touch_updated_at
before update on public.memberships
for each row
execute function public.touch_updated_at();

create or replace function public.current_org_role(target_organization_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.memberships m
  where m.organization_id = target_organization_id
    and m.user_id = auth.uid()
    and m.disabled_at is null
  limit 1
$$;

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.disabled_at is null
  )
$$;

create or replace function public.has_org_role(
  target_organization_id uuid,
  allowed_roles public.org_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.disabled_at is null
      and m.role = any (allowed_roles)
  )
$$;

comment on table public.memberships is 'Tenant authorization source of truth. Client-provided organization claims are not trusted.';
comment on function public.current_org_role(uuid) is 'Used by RLS and server-side guards to derive membership from auth.uid().';
