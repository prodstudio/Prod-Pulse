alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.monitored_apps enable row level security;
alter table public.app_environments enable row level security;
alter table public.monitors enable row level security;
alter table public.monitor_results enable row level security;
alter table public.monitor_result_attempts enable row level security;
alter table public.heartbeats enable row level security;
alter table public.runner_runs enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_updates enable row level security;
alter table public.alert_rules enable row level security;
alter table public.notification_channels enable row level security;
alter table public.alert_deliveries enable row level security;
alter table public.alert_delivery_attempts enable row level security;
alter table public.maintenance_windows enable row level security;
alter table public.status_pages enable row level security;
alter table public.status_page_components enable row level security;
alter table public.integrations enable row level security;
alter table public.audit_logs enable row level security;

create policy "organizations_select_member"
on public.organizations
for select
to authenticated
using (public.is_org_member(id));

create policy "profiles_select_self"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "memberships_select_member"
on public.memberships
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "monitored_apps_select_member"
on public.monitored_apps
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "app_environments_select_member"
on public.app_environments
for select
to authenticated
using (public.is_org_member(organization_id));

-- Secret-bearing tables intentionally omit direct member-scoped selects in this pass.
-- Sanitized server responses or projection views should be added later.

create policy "monitor_results_select_member"
on public.monitor_results
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "monitor_result_attempts_select_member"
on public.monitor_result_attempts
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "runner_runs_select_member"
on public.runner_runs
for select
to authenticated
using (organization_id is not null and public.is_org_member(organization_id));

create policy "incidents_select_member"
on public.incidents
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "incident_updates_select_member"
on public.incident_updates
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "alert_rules_select_member"
on public.alert_rules
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "alert_deliveries_select_member"
on public.alert_deliveries
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "alert_delivery_attempts_select_member"
on public.alert_delivery_attempts
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "maintenance_windows_select_member"
on public.maintenance_windows
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "status_pages_select_member"
on public.status_pages
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "status_page_components_select_member"
on public.status_page_components
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "audit_logs_select_admin"
on public.audit_logs
for select
to authenticated
using (public.has_org_role(organization_id, array['owner'::public.org_role, 'admin'::public.org_role]));

comment on table public.monitors is 'RLS is enabled with no direct select policy because encrypted headers must stay server-mediated.';
comment on table public.notification_channels is 'RLS is enabled with no direct select policy because encrypted Slack webhook config must stay server-mediated.';
comment on table public.integrations is 'RLS is enabled with no direct select policy because encrypted integration config must stay server-mediated.';
comment on table public.heartbeats is 'RLS is enabled with no direct select policy because hashed token material must not be exposed casually.';
