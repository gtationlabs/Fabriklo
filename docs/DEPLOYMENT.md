# Deployment

## Environments

Use **separate Supabase projects** for dev, staging and production, each with its own keys. Never run tests, seeds or destructive scripts against production. `supabase/seed.sql` refuses to run when `app.environment = 'production'`; set it on the production database:

```sql
alter database postgres set app.environment = 'production';
```

## Database

```bash
npx supabase link --project-ref <staging-ref>
npx supabase db push            # applies supabase/migrations
```

Then in the dashboard: enable TOTP MFA (Auth → MFA), set Site URL / redirect URLs, keep "Expose new tables" off, enable PITR/backups for production.

## App (any Node host, e.g. Vercel)

Environment variables (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`. Server-only secrets go into the host's secret store: `SUPABASE_SECRET_KEY` (payment/courier handlers, workers, staff invitations, shared rate limiting), payment/courier/AI/SMTP keys, worker secrets.

Hardening variables:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile on staff sign-in, customer sign-in/sign-up, checkout and newsletter. Both required; with either missing the widget is not rendered and nothing is verified (so staging without keys still works).
- `SENTRY_DSN` (server/edge) and `NEXT_PUBLIC_SENTRY_DSN` (browser), optional `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`. Off when empty. Source maps are not uploaded by default; to get readable stack traces add `SENTRY_AUTH_TOKEN`/org/project and wrap `next.config.ts` in `withSentryConfig` in the deploy branch.
- `RATE_LIMIT_STORE` (leave empty for the shared Postgres store; `memory` forces per-instance counters) and optional `RATE_LIMIT_SALT`.

The Content-Security-Policy is generated per request in `proxy.ts` with a nonce. If the host adds its own CSP header, remove it: two CSP headers are intersected and the stricter one wins, which will break scripts.

`npm ci && npm run build && npm start`.

## First staff account

From a trusted machine with the secret key in the environment (local by default; remote requires `ALLOW_REMOTE_STAFF_BOOTSTRAP=1`):

```bash
npm run staff:create -- owner@example.com super_admin
```

The owner signs in at `/admin/login` and must enrol an authenticator app before reaching the console.

## Edge

Put the site behind Cloudflare (or the host's WAF). The rule-by-rule list (rate limits per path, bot mode, webhook and worker exceptions) is in `SECURITY_RUNBOOK.md` → "Edge / WAF rules". Turnstile keys come from the same Cloudflare account.

## Scheduled jobs

`pg_cron` jobs are created by the migrations (reservation expiry every minute, unpaid-order expiry, try-on expiry, marketing events, rate-limit purge). `supabase db push` creates them on a fresh project; after a logical restore they must be re-created (`BACKUP_RESTORE.md`). The try-on and automation workers also need an external scheduler hitting `/api/tryon/worker` and `/api/automation/worker` with their secrets (every minute).

## Monitoring and backups

Set the Sentry DSNs (above), enable PITR/backups on the production project and schedule `scripts/backup.sh` nightly from a trusted runner (`BACKUP_RESTORE.md`). Run the k6 scenarios against staging before launch (`LOAD_TESTING.md`).
