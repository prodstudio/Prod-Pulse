# Prod Pulse Internal Status-Page Preview

## Purpose

The internal status-page preview gives Prod Studio operators a clean operational view built from real persisted Prod Pulse state.

This phase is internal only. It does not publish an unauthenticated status page, expose a customer-facing route, or support custom domains.

## Component mapping

Each status page contains components mapped to one or more of:

- monitored app
- app environment
- monitor

Mappings stay lightweight. The status-page tables store display and relationship data only. Operational state is still derived from the source systems:

- `monitored_apps`
- `app_environments`
- `monitors`
- `monitor_results`
- `incidents`
- `maintenance_windows`
- `heartbeats` through linked heartbeat monitors

## Status derivation

Component status is derived from the strongest available evidence in this order:

1. active unresolved incidents affecting the mapped app, environment, or monitor
2. current linked monitor status and latest persisted `monitor_results`
3. active maintenance windows
4. app or environment status when monitor evidence is absent

Preview states:

- `operational`
- `degraded`
- `partial_outage`
- `major_outage`
- `maintenance`
- `unknown`

Overall page status is the worst visible component status.

## Internal only

Internal preview means:

- authenticated Prod Pulse access is required
- organization membership is required
- no public `/status/[slug]` route is exposed in this phase
- no subscriptions, custom domains, or external publishing workflow exists

The existing `status_pages.is_public` column remains a reserved metadata flag only. Setting it does not publish a page.

## Security notes

Status-page preview must never expose:

- raw monitor configuration
- raw monitor auth headers
- heartbeat raw tokens
- heartbeat token hashes
- Slack webhook URLs
- encrypted integration or channel config
- provider raw response payloads
- stack traces
- cookies
- authorization headers
- API keys
- Supabase keys
- database URLs
- full response bodies or raw logs

Preview output should contain only safe evidence links and sanitized summaries.

## Future public status pages

Public status pages remain a future phase. That work should be isolated from the internal preview model and add its own publishing, auth, branding, and support controls rather than assuming the internal preview can be exposed directly.
