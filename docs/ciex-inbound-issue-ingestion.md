# CIEX outbound webhook receiver foundation

Phase 12 adds the first CIEX outbound webhook receiver foundation for Prod Pulse.

This phase is intentionally narrow:

- inbound webhook ingestion only
- manual incident linking remains the control point
- no bidirectional sync
- no automatic CIEX ticket updates
- no ticket close/reopen/status mutation back to CIEX
- no raw payload archival

## Route

`POST /api/integrations/ciex/inbound`

This is an internal integration endpoint intended for CIEX to Prod Pulse webhook delivery.

## Architecture

The intended flow is:

1. Customer app embeds the CIEX widget
2. CIEX widget creates or updates a CIEX ticket
3. CIEX sends an outbound webhook event to Prod Pulse
4. Prod Pulse stores a normalized external issue
5. Prod Pulse suggests or allows manual incident linking

Prod Pulse is not part of the CIEX widget token flow. Prod Pulse does not call
`POST /api/support/token`, and it does not embed the CIEX widget.

The CIEX widget/token integration remains for customer-facing applications that want to embed
support directly. Prod Pulse only receives ticket events after CIEX has created or updated the
ticket.

## Authentication contract

Current placeholder contract:

- send `x-prod-pulse-integration-key: <shared secret>`
- Prod Pulse hashes the provided secret with SHA-256
- the hash must match `integrations.inbound_key_hash`
- the integration row must have:
  - `kind = 'ciex'`
  - `is_enabled = true`

Prod Pulse does not trust `organization_id` from the payload. The organization is resolved from the matched integration record.

## Minimal provisioning

Phase 12 does not add an integrations dashboard. CIEX webhook integrations must be provisioned
manually in the database for now.

Recommended secret hash command:

```bash
printf '%s' 'your-shared-secret' | shasum -a 256 | awk '{print $1}'
```

Insert or update an integration row with:

- `organization_id`
- `kind = 'ciex'`
- `name`
- `is_enabled = true`
- `inbound_key_hash`
- optional `inbound_key_hint`

Never store the raw shared secret in plaintext columns.

## Payload shape

Current accepted webhook payload:

```json
{
  "eventType": "ticket.updated",
  "deliveredAt": "2026-06-02T15:00:00Z",
  "ticket": {
    "externalId": "ticket-123",
    "externalKey": "CIEX-123",
    "title": "Customer cannot sign in",
    "summary": "Customer reports repeated auth failures.",
    "status": "open",
    "priority": "high",
    "sourceUrl": "https://ciex.example.com/tickets/123",
    "customerReference": "Acme Corp",
    "appId": "optional-prod-pulse-app-id",
    "environmentId": "optional-prod-pulse-environment-id",
    "monitorId": "optional-prod-pulse-monitor-id",
    "sourceCreatedAt": "2026-06-02T14:45:00Z",
    "sourceUpdatedAt": "2026-06-02T14:59:00Z"
  }
}
```

`appId`, `environmentId`, and `monitorId` are optional deterministic internal references. If supplied, they must belong to the integration's organization and remain relationship-consistent.

## What is stored

Normalized external issue fields only:

- `source_kind = ciex`
- `integration_id`
- `external_id`
- `external_key`
- `title`
- `summary`
- `status`
- `priority`
- `source_url` if safe `http`/`https`
- `customer_reference`
- `first_seen_at`
- `last_synced_at`
- optional `source_created_at`
- optional `source_updated_at`
- optional internal related refs for app/environment/monitor suggestions

## What is explicitly not stored

- arbitrary raw CIEX payloads
- attachments
- auth headers
- raw shared secrets
- stack traces
- uncontrolled customer text blobs outside the normalized fields above

## Suggestions

Prod Pulse may suggest incident links for imported CIEX issues when deterministic internal refs are present:

- exact monitor match
- exact environment match
- exact app match

Suggestions are internal-only and remain manual. This phase does not auto-link tickets to incidents.

## Future work

Deferred intentionally:

- webhook signature upgrades or HMAC-specific CIEX contract
- full integrations settings UI
- polling sync
- bidirectional status updates
- outbound incident-to-CIEX mutation
- attachment import
- raw payload archival
