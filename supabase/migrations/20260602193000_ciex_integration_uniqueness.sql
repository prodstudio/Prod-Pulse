create unique index integrations_one_ciex_per_org_key
  on public.integrations (organization_id)
  where kind = 'ciex';
