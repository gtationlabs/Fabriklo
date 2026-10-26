# Implementation status

_Last updated: 2026-10-26 · Milestone: foundation + vertical slice 1_

This file is the honest source of truth for what exists. It does **not** claim production readiness.

## Starting point

The repository contained only a README. The client supplied five 2D store renders (no 3D source file). The reference site was used for feature/IA inspiration only; no assets, text or code were copied.

## Built and tested in this milestone

| Area | What works | Evidence |
| --- | --- | --- |
| Scaffold | Next.js 16.4 (App Router, TS strict, Tailwind 4), Supabase CLI config, ESLint, Vitest, Playwright, CI workflow | `npm run build` passes |
| Database | 7 migrations: RBAC + audit, catalog, inventory ledger/reservations, carts + order schema, CMS/hero/settings, storage buckets/policies, try-on jobs, search, admin stock views | `supabase db reset` + `supabase db lint` clean |
| Security model | Fail-closed grants, RLS on every table, private helper schema, aal2-gated `has_permission()`, column grants, append-only ledgers | 39 DB tests |
| Seed | 24 published + 1 draft **demo** products (labelled), 177 SKUs, 2 demo warehouses, hero scenes from the 5 renders | `supabase/seed.sql` |
| Store renders | Verified order 01–05 matches spec; converted to responsive WebP (768/1280/1728 + blur) | `docs/3D_TOUR_ASSETS.md` |
| Storefront | Home (static first scene + sections), shop/men/women/category/collection/search with URL filters + pagination, product page with colour/size/SKU availability, guest cart page, cart & products APIs | E2E desktop + mobile, axe |
| Admin | Staff login (throttled, generic errors), mandatory TOTP enrolment/verification, role-filtered console, overview KPIs from real data, product list/create/edit/publish/archive, variants with private cost, stock adjustments (reasoned, idempotent, audited), inventory alerts + ledger | E2E full slice |
| Tests | 15 unit · 39 DB/RLS/concurrency · 17 Playwright | all passing locally |

### Routes working now

Storefront: `/`, `/shop`, `/men`, `/women`, `/category/[slug]`, `/collections/[slug]`, `/search`, `/product/[slug]`, `/cart`
Admin: `/admin/login`, `/admin/mfa`, `/admin`, `/admin/products`, `/admin/products/new`, `/admin/products/[id]`, `/admin/inventory`
API: `GET /api/products`, `GET /api/cart`, `POST|PATCH|DELETE /api/cart/items`

## Mock vs live

There are **no** live third-party integrations yet. No payment, courier, SMS, email or AI provider is called anywhere. Nothing is presented as live.

## Next milestones (in order)

1. **Orders + COD** — `create_order` RPC (quote, reserve, snapshot, idempotency), checkout page, order success + signed tracking token, admin order list/detail with split statuses and state-machine tests, reservation-expiry worker, basic risk flags.
2. **Store tour** — GSAP ScrollTrigger 2.5D sequence over the 5 renders, reverse scroll, skip, reduced-motion/static fallback, mobile tour, screenshot tests, admin hero-scene editor with preview/rollback.
3. CMS pages + theme versions; customer accounts (sign-up/in, addresses, order history).
4. SSLCOMMERZ sandbox, courier adapters (manual first).
5. AI try-on (FASHN) with private storage, queue worker, quotas, deletion.
6. Marketing/coupons/automations, analytics, staff management UI, audit viewer.
7. Hardening: nonce CSP, Turnstile, WAF, Sentry, k6 load tests, backup/restore drill.

## Launch blockers (must be cleared before production)

- Checkout/orders, payment verification and reservation-expiry worker not built.
- CSP still permits inline scripts; rate limiting is single-instance in-memory; no Turnstile/WAF yet.
- No error monitoring; no backup/restore drill performed.
- Forced global sign-out on staff role change not implemented (role changes do take effect immediately in the DB).
- Legal pages (privacy, terms, shipping, returns) are linked but not written; they 404 today.
- Business details (brand name, contact, VAT applicability, delivery fees, COD limits) not supplied — placeholders/configurable settings are used.

## Known limitations / decisions

- `cacheComponents` is disabled (most commerce routes read cookies); revisit for catalog caching.
- Product photos don't exist yet: products show a clearly labelled colour placeholder, never stock photos.
- The renders show another brand's signage; the site brand is configurable and not inferred from them.
- Sandbox note: this milestone was built and tested against a full local Supabase stack (Postgres 17, Auth, PostgREST, Storage) started via the Supabase CLI.

## Credentials needed later (never paste into chat; set in the host secret store)

SSLCOMMERZ store ID/password (sandbox first) · courier API keys (Pathao/Steadfast/RedX, if accounts exist) · FASHN API key · Turnstile site/secret · SMTP/SMS/WhatsApp provider · Sentry DSN · Supabase production/staging projects. See `.env.example`.
