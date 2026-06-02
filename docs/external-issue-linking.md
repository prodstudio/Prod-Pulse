# External Issue / CIEX Linking Foundation

This phase adds the internal-only foundation for linking technical incidents in Prod Pulse to external customer-reported issues such as CIEX tickets.

## CIEX architecture note

Prod Pulse links to CIEX issues after CIEX has already created the ticket.

The intended end-to-end flow is:

1. Customer app uses the CIEX widget and CIEX token flow
2. CIEX creates or updates the ticket inside CIEX
3. CIEX sends an outbound webhook to Prod Pulse at `POST /api/integrations/ciex/inbound`
4. Prod Pulse stores the normalized external issue reference
5. Prod Pulse suggests or allows manual incident linkage

Prod Pulse does not participate in the CIEX widget token exchange and does not call
`/api/support/token`.

## Current scope

This implementation is intentionally narrow:

- manual external issue reference creation only
- manual incident-to-external-issue linking only
- internal incident detail visibility only
- sanitized customer impact summary and notes only

## Explicitly not included in this phase

- no live CIEX API integration
- no webhook ingestion
- no polling or background synchronization
- no bidirectional ticket updates
- no raw external payload storage
- no customer-facing pages

## Data model

Phase 11 adds:

- `external_issues`
  - normalized, org-scoped external issue references
  - safe fields only: source kind, external id/key, title, status, priority, URL, customer reference, summary
- `incident_external_issues`
  - org-scoped join table between `incidents` and `external_issues`
- `incidents.customer_impact_summary`
- `incidents.customer_impact_notes`

The existing `integrations` table remains the future-compatible system registry. This phase does not require a live integration config to create a manual CIEX reference.

## Security decisions

- all mutations remain server-mediated
- all access is org-scoped
- viewer can read linked external issues
- responder, admin, and owner can link and unlink issues
- customer-impact text is sanitized before persistence
- no raw CIEX payloads are stored
- no secrets, auth headers, stack traces, or provider configs are exposed
- audit logs store sanitized snapshots only

## CIEX representation

CIEX is represented as an external issue `source_kind` value. This is only a source classification in this phase, not a live provider contract.

## Future work

Candidate future phases:

1. CIEX inbound webhook ingestion
2. CIEX polling/import jobs if webhook coverage is not sufficient
3. link suggestions between incidents and customer tickets
4. optional outbound incident-state sync back to CIEX

Those future steps should preserve the same constraints:

- sanitize aggressively
- store normalized summaries instead of arbitrary raw payloads
- verify org ownership before linking
- avoid automatic bidirectional state changes until conflict handling is designed
