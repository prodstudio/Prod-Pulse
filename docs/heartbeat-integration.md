# Prod Pulse Heartbeat Integration

## What heartbeat monitoring is for

Heartbeat monitoring is for scheduled jobs, background workers, queue consumers, cron tasks, and third-party integrations that need to tell Prod Pulse they are still running.

Use a heartbeat when a task does not expose a stable HTTP endpoint but should still be tracked for freshness and incident response.

## Ingestion endpoint

Send a `POST` request to:

```text
https://your-prod-pulse-host/api/heartbeats/<token>
```

- The token is the only authentication mechanism for ingestion.
- Tokens are generated server-side.
- Tokens are stored hashed at rest.
- Raw tokens are returned only once on create or rotate responses.

## Payload contract

Allowed payload fields:

```json
{
  "service": "tiquer-worker",
  "environment": "production",
  "jobName": "nightly-ledger-sync",
  "runId": "sync-2026-06-01T03:00:00Z",
  "status": "ok",
  "message": "Completed successfully",
  "durationMs": 18234,
  "timestamp": "2026-06-01T03:00:05Z"
}
```

Field notes:

- `status`: `ok`, `degraded`, or `down`
- `runId`: optional idempotency hint for duplicate-ping suppression
- `timestamp`: optional job-reported timestamp; Prod Pulse still records server receive time

## Example curl

```bash
curl -X POST "https://your-prod-pulse-host/api/heartbeats/<token>" \
  -H "content-type: application/json" \
  -d '{
    "service": "tiquer-worker",
    "environment": "production",
    "jobName": "nightly-ledger-sync",
    "runId": "sync-2026-06-01T03:00:00Z",
    "status": "ok",
    "message": "Completed successfully",
    "durationMs": 18234
  }'
```

## Example Next.js job usage

```ts
async function reportHeartbeat() {
  const response = await fetch(
    `${process.env.PROD_PULSE_URL}/api/heartbeats/${process.env.PROD_PULSE_HEARTBEAT_TOKEN}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        service: "tiquer-worker",
        environment: process.env.VERCEL_ENV ?? "production",
        jobName: "nightly-ledger-sync",
        runId: `sync-${new Date().toISOString()}`,
        status: "ok",
        message: "Completed successfully",
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Heartbeat ping failed");
  }
}
```

## Security warnings

Do not send:

- authorization headers
- cookies
- bearer tokens
- API keys
- Supabase keys
- database URLs
- webhook URLs
- stack traces
- raw logs
- full provider payloads

Prod Pulse sanitizes ingested payloads, but callers still need to keep heartbeat messages small and clean.

## Rotation guidance

- Rotate heartbeat tokens when a worker changes ownership, deployment boundaries, or secret scope.
- Treat the raw token like any other write-capable secret.
- Replace the token in the caller before disabling the old one in dependent systems.
- Raw tokens are not retrievable later from Prod Pulse.

## Freshness behavior

- Heartbeats are evaluated by the scheduled monitor runner through the linked heartbeat monitor.
- Fresh heartbeats create successful scheduled `monitor_results`.
- Missed heartbeats create failed scheduled `monitor_results`.
- Scheduled stale results feed the existing incident engine and Slack alert queue automatically.
- Direct heartbeat ingestion does not create incidents or send alerts by itself.
