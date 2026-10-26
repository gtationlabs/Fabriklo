# Security runbook

Status: development baseline. **Not production-ready** until the launch-blocker list in `IMPLEMENTATION_STATUS.md` is cleared.

## Controls in place

- Supabase RLS on every table, explicit grants, private helper schema, `SECURITY DEFINER` functions with empty `search_path` (see `DATABASE_AND_RLS.md`). Linted with `supabase db lint`.
- Staff access requires: active `staff_members` row + permission + **aal2** (TOTP). Enforced in Postgres (`private.has_permission`), in every admin page/action, and (cosmetically) in menus.
- Identity from verified JWTs (`auth.getClaims()`), never from `user_metadata`.
- No secret/service key on any request path. `SUPABASE_SECRET_KEY` is used only by local scripts and tests (and later by workers).
- Staff login: per-IP and per-email throttling, generic error message (no account enumeration).
- JSON mutations: same-origin check (Origin / Sec-Fetch-Site), Zod validation, body size limit, per-IP rate limit, uniform error envelope (no SQL/stack leakage).
- Cookies: Supabase session cookies via `@supabase/ssr`; cart cookie httpOnly + SameSite=Lax + Secure in production.
- Headers: CSP (`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`), nosniff, DENY framing, strict referrer, Permissions-Policy, COOP, HSTS in production, `X-Robots-Tag: noindex` for admin/cart/checkout/account. `poweredByHeader: false`.
- Append-only audit log for product/variant/cost changes, staff role changes, hero/settings changes and stock adjustments.
- Customer try-on photos: private buckets, owner-folder policies, staff cannot list them by default.

## Known gaps (tracked)

| Gap | Plan |
| --- | --- |
| CSP still allows `'unsafe-inline'` scripts | Move to nonce-based CSP via `proxy.ts` |
| In-memory rate limiter (single instance) | Add Cloudflare/host WAF rate rules; Redis/Upstash store for multi-instance |
| Turnstile not yet wired | Add on staff login, sign-up, checkout, try-on uploads; verify server-side incl. hostname/action |
| Forced session revocation on role change | Staff UI will call Auth admin global sign-out |
| Error monitoring (Sentry-equivalent) | Add with scrubbing of PII/images |
| Customer auth pages | Sign-in/up with Turnstile in the account milestone |

## Incident basics

1. **Leaked secret key** → rotate in Supabase dashboard (API keys) immediately, redeploy, review `audit_events` and Auth logs for the window.
2. **Compromised staff account** → set `staff_members.status = 'suspended'` (immediate effect), sign the user out globally via Auth admin, unenrol their MFA factors, review audit log by `actor_id`.
3. **Suspicious stock or price changes** → `audit_events` and `stock_movements` are append-only; correct with compensating movements, never edits.

## Release checklist

- [ ] `npm audit --audit-level=high`, `supabase db lint`, Supabase Security Advisor clean
- [ ] Secret scan of the repo and CI logs
- [ ] RLS tests green against a staging project built from the same migrations
- [ ] Separate prod/staging/dev projects; MFA on Supabase org accounts
- [ ] WAF + rate rules + Turnstile configured
- [ ] Backups/PITR and a storage restore drill done (`BACKUP_RESTORE.md`)
