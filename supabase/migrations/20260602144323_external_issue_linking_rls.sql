alter table public.external_issues enable row level security;
alter table public.incident_external_issues enable row level security;

create policy "external_issues_select_member"
on public.external_issues
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "incident_external_issues_select_member"
on public.incident_external_issues
for select
to authenticated
using (public.is_org_member(organization_id));

comment on table public.external_issues is 'RLS is enabled with member-scoped selects. Writes stay server-mediated so customer-impact text remains sanitized.';
comment on table public.incident_external_issues is 'RLS is enabled with member-scoped selects. Writes stay server-mediated to prevent unsafe cross-org linking.';
