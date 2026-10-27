# Security runbook

Status: development baseline with the hardening slice applied. **Not production-ready** until the launch-blocker list in `IMPLEMENTATION_STATUS.md` is cleared (credentials, real-rate settings, legal text, provider runs).

## Controls in place

- Supabase RLS on every table, explicit grants, private helper schema, `SECURITY DEFINER` functions with empty `search_path` (see `DATABASE_AND_RLS.md`). Linted with `supabase db lint`.
- Staff access requires: active `staff_members` row + permission + **aal2** (TOTP). Enforced in Postgres (`private.has_permission`), in every admin page/action, and (cosmetically) in menus. Role change or suspension also signs the member out of every session through the Auth admin API (best effort; the next request is refused by the DB regardless).
- Identity from verified JWTs (`auth.getClaims()`), never from `user_metadata`.
- No service key on any page. `SUPABASE_SECRET_KEY` is used server-side only, for a short list of service-role RPCs (payment settle, courier webhooks, workers, staff invitations, rate-limit counters).
- **Content Security Policy** built per request in `proxy.ts` (`lib/security/csp.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'` for scripts (dev adds `'unsafe-eval'` for React Refresh only), `style-src 'self' 'unsafe-inline'` (styles cannot execute), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` in production. Third-party origins (GA4, Meta Pixel, Turnstile, Sentry) are added only when that integration is configured. Every `next/script` tag carries the nonce.
- Other headers: nosniff, DENY framing, strict referrer, Permissions-Policy, COOP, HSTS in production, `X-Robots-Tag: noindex` for admin/cart/checkout/account. `poweredByHeader: false`.
- **Rate limiting**: fixed-window counters shared across instances in Postgres (`public.rate_limit_hit`, service_role-only, keys are SHA-256 digests, purged by pg_cron). Falls back to the per-instance memory limiter when the store is unavailable (logged). Limits: staff login 30/IP + 5/email per 15 min; customer login 10/IP + 5/email; sign-up 5/IP/h; orders 8/IP per 10 min; quote/cart 60/min; listing 120/min; newsletter 5 per 10 min; try-on 10 jobs + 20 uploads per customer per hour.
- **Cloudflare Turnstile** on staff sign-in, customer sign-in/sign-up, checkout order POST and newsletter subscribe (`lib/security/turnstile.ts`). Verified server-side against `siteverify` with the client IP; fails closed when Cloudflare is unreachable. Active only when both keys are set; the admin and the docs never claim protection otherwise.
- JSON mutations: same-origin check (Origin / Sec-Fetch-Site), Zod validation, body size limit, rate limit, uniform error envelope (no SQL/stack leakage).
- Cookies: Supabase session cookies via `@supabase/ssr`; cart cookie httpOnly + SameSite=Lax + Secure in production.
- **Error monitoring**: Sentry (`@sentry/nextjs`) on server, edge and browser, initialised only when a DSN is set. `sendDefaultPii: false`; request bodies, cookies and IPs are dropped; emails, JWTs and Supabase keys are scrubbed in `beforeSend` (`lib/monitoring/sentry-options.ts`); Session Replay is not enabled (it would record customer photos). Try-on images never enter error context.
- Append-only audit log for product/variant/cost changes, staff events, hero/theme/settings changes, stock adjustments; masked viewer and CSV in Admin → Audit.
- Customer try-on photos: private buckets, owner-folder policies, staff cannot list them by default; expiry + purge jobs.
- Outbound webhooks: allowlisted hosts only, https, no IP literals / internal ranges / lookalikes, HMAC signed, no redirects.

## Edge / WAF (Cloudflare) rules to configure

Set these on the zone in front of the app (the app's own limits are the second line, not the first):

| Rule | Expression | Action |
| --- | --- | --- |
| Admin login burst | `http.request.uri.path eq "/admin/login" and http.request.method eq "POST"` | Rate limit 10 / 1 min per IP → block 10 min |
| Customer auth | `starts_with(http.request.uri.path, "/account/") and http.request.method eq "POST"` | Rate limit 20 / 1 min per IP |
| Checkout + coupon | `http.request.uri.path in {"/api/checkout/orders" "/api/checkout/coupon"}` | Rate limit 10 / 10 min per IP → managed challenge |
| Cart / quote / listing | `starts_with(http.request.uri.path, "/api/cart") or http.request.uri.path eq "/api/checkout/quote" or http.request.uri.path eq "/api/products"` | Rate limit 120 / 1 min per IP |
| Try-on uploads | `starts_with(http.request.uri.path, "/api/tryon/")` | Rate limit 30 / 10 min per IP |
| Admin geo/ASN (optional) | `starts_with(http.request.uri.path, "/admin") and not ip.geoip.country in {"BD"}` | Managed challenge (adjust to where staff actually are) |
| Bots | Super Bot Fight Mode / Bot Fight Mode on; verified bots allowed | Challenge definitely-automated |
| Payment/courier webhooks | `starts_with(http.request.uri.path, "/api/payments/") or starts_with(http.request.uri.path, "/api/couriers/")` | **Skip** bot and rate rules (signatures are verified in the app) |
| Worker endpoints | `http.request.uri.path in {"/api/tryon/worker" "/api/automation/worker"}` | Allow only the scheduler's IPs, else block |

Also: HTTPS only + HSTS, "Always Use HTTPS", TLS 1.2 minimum, managed WAF ruleset on, and restrict origin access to Cloudflare IPs if the host allows it.

## Remaining gaps (tracked)

| Gap | Plan |
| --- | --- |
| Sentry source maps are not uploaded | Add `SENTRY_AUTH_TOKEN` and wrap `next.config.ts` with `withSentryConfig` at deploy time |
| Turnstile hostname/action are not re-checked server-side | Add `expectedAction` + hostname check once the production domain is fixed |
| Load tests not yet executed | `docs/LOAD_TESTING.md` |
| Customer-facing MFA | Not planned for v1 |

## Incident basics

1. **Leaked secret key** → rotate in Supabase dashboard (API keys) immediately, redeploy, review `audit_events` and Auth logs for the window.
2. **Compromised staff account** → suspend in Admin → Staff (this also signs them out everywhere), reset their authenticator from the same page, review the audit log by actor.
3. **Suspicious stock or price changes** → `audit_events` and `stock_movements` are append-only; correct with compensating movements, never edits.
4. **Bot wave on checkout/newsletter** → tighten the WAF rules above first (immediate), then check `rate_limit_buckets` growth and Turnstile analytics.

## Release checklist

- [ ] `npm audit --audit-level=high`, `supabase db lint`, Supabase Security Advisor clean
- [ ] Secret scan of the repo and CI logs
- [ ] RLS tests green against a staging project built from the same migrations
- [ ] Separate prod/staging/dev projects; MFA on Supabase org accounts
- [ ] WAF + rate rules configured (table above); Turnstile keys set and the widget visible on the four forms
- [ ] Sentry DSN set; one deliberate test error visible with no PII
- [ ] Backups/PITR on; restore drill done this quarter (`BACKUP_RESTORE.md`)
- [ ] Load test run on staging (`LOAD_TESTING.md`)
