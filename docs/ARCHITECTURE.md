# Architecture

Fabriklo is a Next.js (App Router, TypeScript strict) storefront and staff console on top of Supabase (Postgres, Auth, Storage). Postgres is the system of record **and** the final authorization layer.

```
Browser ──► Next.js (proxy.ts: session refresh, /admin bounce)
             ├─ Server Components / Server Actions / Route Handlers
             │    • Zod validation, rate limits, same-origin checks
             │    • requireStaff()/checkStaff(): verified JWT + current role rows + aal2
             │    • Supabase client AS THE USER (publishable key + user JWT) → RLS applies
             └─ Anonymous public client (catalog, capability-token cart RPCs)
                                │
                                ▼
                    Supabase Postgres (RLS on every table)
                      • public schema: tables + narrowly granted RPCs
                      • private schema (not exposed): has_permission(), ledgers' internals,
                        reserve/commit/release stock, audit writer
                      • append-only ledgers enforced by triggers
                    Supabase Auth (password + TOTP MFA)   Supabase Storage (bucket policies)

Trusted workers/scripts (secret key, never in browser): reservation expiry, try-on jobs, webhooks (later milestones)
```

## Principles

1. **Three locks, not one.** UI hides what you can't use (cosmetic) → server action/route re-checks permission + MFA → Postgres RLS/RPC checks again with the caller's JWT. The service/secret key is not used on any request path.
2. **Current permissions, not cached claims.** `private.has_permission()` reads `staff_members` + `role_permissions` on every call and requires `aal = aal2`. Suspending a staff member or changing a role takes effect on their next query.
3. **Money is integer poisha.** `price_minor`, `total_minor` etc. Formatting happens only at the edge (`lib/money.ts`).
4. **Stock never changes without the ledger.** All stock changes go through `private.apply_stock_movement()`, which row-locks the balance, validates, updates, and appends to `stock_movements` (immutable). See `docs/INVENTORY_TRANSACTIONS.md`.
5. **Guest carts are capability tokens.** A 256-bit random token in an httpOnly cookie; Postgres stores only its SHA-256. Cart RPCs re-price from the DB every time.
6. **Typed content only.** CMS/hero data is validated by Zod and SQL CHECKs (bounded numbers, internal-only links, allow-listed image paths). No raw HTML/JS from editors.

## Folder map

| Path | Purpose |
| --- | --- |
| `app/(shop)` | Storefront routes |
| `app/admin/login`, `app/admin/mfa` | Staff sign-in and TOTP enrol/verify |
| `app/admin/(console)` | Protected console (layout calls `requireStaff()`) |
| `app/api` | JSON route handlers (cart, products) |
| `components/shop`, `components/admin`, `components/store-tour` | UI |
| `lib/auth` | Staff state, permission list, nav filtering |
| `lib/security` | Rate limiting, origin checks, error envelopes |
| `lib/supabase` | Server (user JWT), browser, and anonymous clients |
| `lib/catalog`, `lib/cart`, `lib/cms` | Domain services and Zod schemas |
| `supabase/migrations` | Versioned SQL, RLS, RPCs |
| `supabase/seed.sql` | Development-only demo data (`is_demo = true`) |
| `tests/unit`, `tests/db`, `tests/e2e` | Vitest unit, SQL/RLS integration, Playwright |

Planned modules (`lib/orders`, `lib/payments`, `lib/couriers`, `lib/tryon`, `lib/marketing`, `lib/automation`) arrive with their milestones; see `IMPLEMENTATION_STATUS.md`.

## Why no ORM

Privileged logic lives in Postgres functions (tested directly in `tests/db`), and request-path reads use `supabase-js` with the user's JWT so RLS always applies. An ORM connected as a privileged DB user would bypass RLS on every query, which is the opposite of what we want. Revisit only for trusted workers, and never as the security layer.

## Store tour renderer

The homepage hero is designed around a `StoreTourRenderer` boundary (`hero_tours.renderer`: `scroll-2.5d` | `static` | `gltf`). The current build ships the static first scene; the GSAP 2.5D scroll tour is the next hero milestone, and a glTF/Blender renderer can replace it later without changing the CMS schema. See `docs/3D_TOUR_ASSETS.md`.
