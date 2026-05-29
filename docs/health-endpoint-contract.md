# Prod Pulse Health Endpoint Contract

Prod Pulse expects monitored SaaS applications to expose a JSON health endpoint that is safe to persist, safe to inspect in dashboards, and strict enough to validate automatically.

## Purpose

This contract is for application readiness and operational health, not a marketing-facing uptime badge and not a deep diagnostics dump. It should answer whether the application is healthy enough to serve traffic and which high-level dependencies are degraded.

Recommended endpoint behavior:

- Return JSON only.
- Use `Cache-Control: no-store`.
- Avoid secrets, stack traces, database errors, tokens, internal hostnames, or verbose upstream diagnostics.
- Prefer HTTP `200` for `ok` and `degraded`, and HTTP `503` for `down`.

## Response Shape

```json
{
  "status": "ok",
  "service": "tiquer",
  "environment": "production",
  "version": "1.0.0",
  "commit": "abc123",
  "timestamp": "2026-05-29T14:00:00Z",
  "checks": {
    "database": {
      "status": "ok",
      "latencyMs": 42
    },
    "auth": {
      "status": "ok"
    },
    "storage": {
      "status": "ok"
    },
    "external": {
      "stripe": "ok",
      "twilio": "ok",
      "arca": "ok"
    }
  }
}
```

## Required Fields

- `status`: one of `ok`, `degraded`, `down`
- `service`: non-empty service identifier
- `environment`: non-empty deployment environment
- `timestamp`: ISO-8601 UTC timestamp
- `checks`: object of named dependency checks

Optional fields:

- `version`
- `commit`

## Check Semantics

Each check entry may be either:

- a string status: `ok`, `degraded`, or `down`
- an object with:
  - `status`
  - optional `latencyMs`

Nested groups are allowed so long as the overall `checks` value stays object-shaped.

Good examples:

- `database: { "status": "ok", "latencyMs": 42 }`
- `storage: { "status": "degraded" }`
- `external: { "stripe": "ok", "twilio": "down" }`

Avoid:

- secret-bearing details
- raw error stacks
- nullable required fields
- arrays in place of `checks`

## Validation Rules

Prod Pulse validates:

- top-level contract shape
- allowed status values
- parseable timestamps
- optional staleness windows
- required check presence when the monitor is configured to require specific checks

The contract is intentionally safe to store. Private dependency details are optional and should stay shallow even when included.
