create or replace function public.bootstrap_initial_owner(
  target_user_id uuid,
  target_email text,
  target_full_name text,
  target_avatar_url text,
  organization_name text,
  organization_slug text
)
returns table (organization_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_organization_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('prod_pulse_initial_owner_bootstrap', 0));

  if exists (
    select 1
    from public.memberships
    where disabled_at is null
    limit 1
  ) then
    raise exception using errcode = '42501';
  end if;

  insert into public.profiles (id, email, full_name, avatar_url)
  values (target_user_id, target_email, target_full_name, target_avatar_url)
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        avatar_url = excluded.avatar_url,
        updated_at = timezone('utc', now());

  insert into public.organizations (name, slug, created_by)
  values (organization_name, organization_slug, target_user_id)
  returning id into created_organization_id;

  insert into public.memberships (organization_id, user_id, role, invited_by)
  values (created_organization_id, target_user_id, 'owner', target_user_id);

  return query
  select created_organization_id;
end;
$$;

revoke all on function public.bootstrap_initial_owner(uuid, text, text, text, text, text)
from public, anon, authenticated;

comment on function public.bootstrap_initial_owner(uuid, text, text, text, text, text)
is 'Atomic first-owner bootstrap guarded by a transaction lock. Intended for server-only use after validating the bootstrap token.';
