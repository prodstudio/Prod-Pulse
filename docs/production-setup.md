# Prod Pulse Production Setup

This document covers the production environment contract and the first-owner bootstrap flow for Prod Pulse.

## Required environment variables

### Public values

These are safe to expose to browser code and should not be marked sensitive in Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

### Sensitive server-only values

These must be marked sensitive in Vercel:

- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_ENCRYPTION_KEY`
- `CRON_SECRET`
- `INITIAL_OWNER_BOOTSTRAP_TOKEN`

### Server-only non-secret flags

These stay server-side, but they are feature flags rather than secrets:

- `SLACK_ALERTS_ENABLED`
- `MONITOR_RUNNER_ENABLED`
- `ALERT_RUNNER_ENABLED`

## Generate secure values

Generate each value independently.

### APP_ENCRYPTION_KEY

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
```

### CRON_SECRET

```bash
node -e 'console.log(require("node:crypto").randomBytes(48).toString("base64url"))'
```

### INITIAL_OWNER_BOOTSTRAP_TOKEN

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
```

Keep `APP_ENCRYPTION_KEY` stable after alert channels are created. Rotating it without re-encrypting stored secrets will break Slack webhook decryption.

## Apply Supabase migrations

Local reset and verification:

```bash
supabase start
supabase db reset --local
```

Push local migrations to the linked remote project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## Create the first Supabase Auth user

Create the user in Supabase Auth before attempting application login.

Recommended path:
1. Open the Supabase dashboard for the target project.
2. Go to `Authentication` -> `Users`.
3. Create a user with email and password.
4. Confirm the user if your project requires email confirmation before sign-in.

Prod Pulse will sync the `profiles` row after the user signs in.

## Complete the first-owner bootstrap

Bootstrap is intentionally one-time only.

Requirements:
- user can sign in successfully
- `INITIAL_OWNER_BOOTSTRAP_TOKEN` is configured in Vercel
- zero active memberships currently exist in the deployment

Steps:
1. Sign in at `/login` with the Supabase Auth user.
2. If no active memberships exist, the dashboard will show the bootstrap form.
3. Enter:
   - full name
   - organization name
   - organization slug
   - bootstrap token
4. Submit the form.
5. Prod Pulse will atomically create:
   - the `profiles` record
   - the first `organizations` record
   - the first `memberships` record with `owner` role

After the first active membership exists, the bootstrap form is permanently disabled for later users.

## Verify production after deploy

Manual production checks:
1. Open the app root and confirm the sign-in CTA is visible.
2. Visit a protected route while signed out and confirm redirect to `/login?next=...`.
3. Sign in with the intended admin account.
4. Confirm the dashboard loads instead of the old auth stub.
5. If this is the first deployment, complete bootstrap and confirm:
   - organization header appears
   - dashboard loads real persisted state
   - main navigation works
6. Sign out and confirm return to `/login?status=signed_out`.

Operational checks:
1. Confirm the required Vercel env vars are present in Production.
2. Confirm `NEXT_PUBLIC_APP_URL` matches the deployed production URL.
3. If cron jobs should run, confirm:
   - `CRON_SECRET`
   - `MONITOR_RUNNER_ENABLED`
   - `ALERT_RUNNER_ENABLED`
4. If Slack alert delivery should run, confirm:
   - `APP_ENCRYPTION_KEY`
   - `SLACK_ALERTS_ENABLED`

## Current runtime env contract

Prod Pulse currently reads these runtime env vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_ENCRYPTION_KEY`
- `CRON_SECRET`
- `INITIAL_OWNER_BOOTSTRAP_TOKEN`
- `SLACK_ALERTS_ENABLED`
- `MONITOR_RUNNER_ENABLED`
- `ALERT_RUNNER_ENABLED`
- `NEXT_PUBLIC_APP_URL`
