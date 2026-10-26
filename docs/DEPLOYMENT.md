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

Environment variables (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`. Server-only secrets (`SUPABASE_SECRET_KEY`, payment/courier/AI keys) go into the host's secret store and are **not** needed by the web app in this milestone.

`npm ci && npm run build && npm start`.

## First staff account

From a trusted machine with the secret key in the environment (local by default; remote requires `ALLOW_REMOTE_STAFF_BOOTSTRAP=1`):

```bash
npm run staff:create -- owner@example.com super_admin
```

The owner signs in at `/admin/login` and must enrol an authenticator app before reaching the console.

## Edge

Put the site behind Cloudflare (or the host's WAF): managed rules, rate limits on `/admin/login`, `/api/cart/*` and (later) checkout/try-on, bot protection, HTTPS only.

## Scheduled jobs (order milestone)

`release_expired_reservations` must run every minute via `pg_cron` or a deployed worker using the service role. Not scheduled yet because checkout isn't live.
