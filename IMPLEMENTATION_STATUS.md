# Implementation status

_Last updated: 2026-10-26 · Milestone: foundation, slice 1 (catalog/admin), slice 2 (orders + cash on delivery), slice 3 (scroll store tour + hero editor), slice 4 (content pages + customer accounts), slice 5 (online payment + courier webhooks), slice 6 (AI virtual try-on)_

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
| Orders + COD (slice 2) | Migration 0008: shipping zones, 64 districts, server quote, idempotent `create_order` with atomic stock commit + snapshots, HMAC tracking tokens, state machine with guards, restock on cancel/return, manual shipments, explainable risk rules, pg_cron reservation expiry. Checkout page (BD address, phone normalisation, COD), order success with private tracking link, `/orders/track`. Admin orders list (views + search), order detail (timeline, transitions, courier entry, internal notes, flag), risk review queue | 16 order DB tests + 1 concurrency test + 3 E2E |
| Store tour (slice 3) | GSAP ScrollTrigger 2.5D walkthrough over the 5 renders (push-in, drift, cross-dissolves, reversible), scene dots, skip, inert hidden scenes, reduced-motion / no-JS static panels, softer mobile motion. Migration 0009: draft scenes vs immutable published versions, publish/rollback RPCs (cms.publish), reorder, draft settings, stricter internal-link CHECK. Admin "Content & hero" editor with draft preview and version history | 5 hero DB tests + 10 tour E2E (desktop + mobile) + 1 editor E2E |
| Content pages (slice 4) | Migration 0010: draft blocks vs immutable published versions, allow-listed block types enforced in Zod **and** SQL, publish/rollback/unpublish RPCs, reserved-slug guard, publish-permission trigger. `/[slug]` renderer (plain text, internal links only). Admin block editor with preview, SEO fields, version history. 7 starter template pages seeded (marked as templates) | 3 DB tests + 2 E2E |
| Customer accounts (slice 4) | Sign up / sign in / sign out / password reset (generic messages, rate limits), `/auth/confirm` link handler, account page with order history, order detail via re-derived tracking token, addresses (up to 10, one default), profile edits. Orders placed while signed in are linked to the account; checkout prefills the default address | 4 DB tests + 2 E2E |
| Online payment (slice 5) | Migration 0011: `payment_transactions` / append-only `payment_events`, online orders **hold** stock until paid, service-role-only `payment_begin` / `payment_settle` (exact amount + currency + unique `val_id`, commits or re-reserves stock, flags gateway risk), `expire_unpaid_orders` cron, void-on-cancel trigger. Provider interface + SSLCOMMERZ v4 adapter (server-created session, IPN signature check, validation API as the authority, de-duplicated event log, browser return never trusted). Checkout "Pay online" option, `/order/payment` result page with retry, admin payment-attempt panel. Labelled **mock** gateway when no credentials (never in production without an explicit flag) | 9 DB tests + 9 unit + 2 E2E |
| Couriers (slice 5) | `CourierAdapter` interface; manual adapter (unchanged staff entry); signed-webhook stubs for Pathao/Steadfast/RedX → `courier_apply_event` (dedupe on event id, state machine, auto-fulfil on hand-over, restock on return, unknown events stored not applied). Endpoint is 404 until a secret is configured | 1 DB test + unit + 1 E2E |
| AI try-on (slice 6) | Migration 0012: queue RPCs (`tryon_create_job` with consent version, owned-photo check, garment support, one-in-flight, per-customer/site quotas, credit cap), worker RPCs (`claim` with SKIP LOCKED, `job_event` dedupe, `complete` into the owner's folder + usage ledger, `fail` with bounded retries), expiry list/purge + cron fallback, append-only consent/provider/usage ledgers, staff stats + limits RPCs. Server-side photo validation (magic bytes, decode, size/aspect, EXIF stripped, resized), private per-user buckets, worker that never runs in the browser, FASHN v1.6 adapter (base64 in/out for privacy), labelled demo mock without a key. Product-page panel (consent + disclosure, before/after, download, delete), `/account/try-on`, admin **AI try-on** page (counts, cap alert, limits, run queue) and garment upload on the product page | 7 unit + 7 DB + 3 E2E |
| Tests | 44 unit · 84 DB/RLS/concurrency · 41 Playwright | all passing locally |

### Routes working now

Storefront: `/`, `/shop`, `/men`, `/women`, `/category/[slug]`, `/collections/[slug]`, `/search`, `/product/[slug]`, `/cart`, `/checkout`, `/order/success`, `/orders/track`, `/[slug]` (CMS pages: shipping, returns, size-guide, about, contact, privacy, terms), `/account`, `/account/login`, `/account/register`, `/account/forgot`, `/account/reset`, `/account/addresses`, `/account/orders/[number]`, `/auth/confirm`, `/order/payment` (+ `POST /order/payment/retry`), `/pay/mock/[tranId]` (mock only), `/account/try-on`
Admin: `/admin/login`, `/admin/mfa`, `/admin`, `/admin/products`, `/admin/products/new`, `/admin/products/[id]`, `/admin/inventory`, `/admin/orders`, `/admin/orders/[id]`, `/admin/risk`, `/admin/content`, `/admin/content/preview`, `/admin/content/pages/[id]`, `/admin/tryon`
API: `GET /api/products`, `GET /api/cart`, `POST|PATCH|DELETE /api/cart/items`, `POST /api/checkout/quote`, `POST /api/checkout/orders`, `POST /api/payments/[provider]/ipn`, `POST|GET /api/payments/[provider]/return`, `POST /api/payments/mock/complete` (mock only), `POST /api/couriers/[courier]/webhook`, `POST /api/tryon/uploads`, `POST /api/tryon/jobs`, `GET|DELETE /api/tryon/jobs/[id]`, `POST /api/tryon/worker` (secret)

## Mock vs live

- **SSLCOMMERZ**: adapter built and unit-tested with stubbed HTTP; **not yet run against the real sandbox** (needs the owner's sandbox store credentials and a public IPN URL). Until credentials exist, non-production builds use a **mock gateway** that is labelled as such everywhere it appears and moves no money. Production with no credentials offers cash on delivery only.
- **Couriers**: manual entry only. Pathao/Steadfast/RedX webhook stubs exist behind per-courier secrets and are **not verified against live APIs**; shipment creation/labels are not built.
- **FASHN try-on**: adapter built and unit-tested with stubbed HTTP; **not yet run against the real API** (needs `FASHN_API_KEY` and a real garment photo). Without a key, non-production builds use a **demo mock** that calls no provider and is labelled everywhere; production hides the feature.
- No SMS or email provider is called anywhere. Nothing is presented as live.

## Next milestones (in order)

1. ~~Orders + COD~~ done in slice 2.
2. ~~Store tour~~ done in slice 3.
3. ~~CMS pages + customer accounts~~ done in slice 4 (theme versions still to do).
4. ~~SSLCOMMERZ + courier adapters~~ done in slice 5 (real-sandbox run pending credentials).
5. ~~AI try-on~~ done in slice 6 (real-API run pending key).
6. Marketing/coupons/automations, analytics, staff management UI, audit viewer.
7. Hardening: nonce CSP, Turnstile, WAF, Sentry, k6 load tests, backup/restore drill.

## Launch blockers (must be cleared before production)

- FASHN try-on has not been exercised against the real API (adapter, privacy choices and budget cap built; needs the key, a real garment photo and one run). Garment photos for real products must be uploaded by the owner; the seed uses a labelled placeholder drawing.
- SSLCOMMERZ has not been exercised against the real sandbox (adapter + verification built; needs credentials, a public IPN URL and one end-to-end run before go-live). No gateway refund flow yet.
- Shipping zone fees and the COD limit are **demo values**: the owner must set real rates (admin settings UI for zones is a later milestone; today they're edited in the database).
- No order confirmation SMS/email: customers rely on the private tracking link shown after checkout.
- Order rate limit is per-instance in memory (8 orders / 10 min / IP); add edge limits + Turnstile before launch.
- CSP still permits inline scripts; rate limiting is single-instance in-memory; no Turnstile/WAF yet.
- No error monitoring; no backup/restore drill performed.
- Forced global sign-out on staff role change not implemented (role changes do take effect immediately in the DB).
- Legal and help pages exist as **templates** with a visible warning; the owner must replace the text (privacy/terms need professional review).
- Account emails (confirmation, password reset) need an SMTP provider configured in Supabase Auth; locally, sign-ups are auto-confirmed and reset links are not delivered.
- The store renders show "ALVIC STORE" signage; replace or mask before launch if that is not the brand.
- Business details (brand name, contact, VAT applicability, delivery fees, COD limits) not supplied — placeholders/configurable settings are used.

## Known limitations / decisions

- `cacheComponents` is disabled (most commerce routes read cookies); revisit for catalog caching.
- Product photos don't exist yet: products show a clearly labelled colour placeholder, never stock photos.
- The renders show another brand's signage; the site brand is configurable and not inferred from them.
- Sandbox note: this milestone was built and tested against a full local Supabase stack (Postgres 17, Auth, PostgREST, Storage) started via the Supabase CLI.

## Credentials needed later (never paste into chat; set in the host secret store)

SSLCOMMERZ store ID/password (sandbox first; set `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`) · courier webhook secrets / API keys (Pathao/Steadfast/RedX, if accounts exist) · `SUPABASE_SECRET_KEY` on the server for payment/courier handlers · FASHN API key (`FASHN_API_KEY`) + `TRYON_WORKER_SECRET` for the scheduler · Turnstile site/secret · SMTP/SMS/WhatsApp provider · Sentry DSN · Supabase production/staging projects. See `.env.example`.
