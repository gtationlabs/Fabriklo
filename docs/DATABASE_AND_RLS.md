# Database and RLS

All migrations live in `supabase/migrations` and are applied with `npx supabase db reset` (local) or `supabase db push` (linked project).

## Fail-closed defaults

- `supabase/config.toml` sets `auto_expose_new_tables = false`, and migration `0001` revokes default privileges for `anon`/`authenticated` on new tables, sequences and functions in `public` and `private`.
- Every table has RLS enabled. Grants are explicit per table and per column where needed (e.g. customers may only `UPDATE (full_name, phone, marketing_opt_in)` on `profiles`).
- Internal helpers live in the `private` schema, which is **not** exposed through the Data API.
- `service_role` keeps table access (bypasses RLS) for trusted workers only; append-only triggers still apply to it.

## Key functions

| Function | Security | Callable by | Purpose |
| --- | --- | --- | --- |
| `private.has_permission(text)` | definer | authenticated (via policies) | Current staff role → permission, requires `aal2` |
| `private.is_super_admin()` | definer | authenticated | Used to restrict super-admin assignment |
| `public.my_staff_context()` | definer | authenticated | UI menu data (cosmetic) |
| `public.get_variant_availability(uuid[])` | definer | anon, authenticated | Available units for **published** variants only, capped at 99 |
| `public.catalog_search(...)`, `public.catalog_facets()` | invoker | anon, authenticated | Storefront search under caller's RLS |
| `public.cart_create/cart_get/cart_set_item` | definer | anon, authenticated | Capability-token cart, server-priced |
| `public.admin_adjust_stock(...)` | definer | authenticated (checks `inventory.adjust`) | Reasoned, idempotent stock adjustment + audit; large deltas need `inventory.approve_large` |
| `public.admin_variant_stock()`, `public.admin_stock_alerts()` | invoker | authenticated (needs `inventory.read`) | Admin stock views |
| `private.reserve_stock`, `private.close_reservation` | definer | internal only | Checkout reservations (order milestone) |
| `public.release_expired_reservations(int)` | definer | service_role only | Worker entry point; `FOR UPDATE SKIP LOCKED`, exactly-once |

All `SECURITY DEFINER` functions set `search_path = ''`, schema-qualify every reference, and have `EXECUTE` revoked from `public` before granting to specific roles.

## Table access summary

| Table | anon | customer | staff (aal2 + permission) |
| --- | --- | --- | --- |
| products, variants, media, categories, collections | published only | published only | all (`products.read`), write (`products.write`) |
| variant_costs | — | — | `products.costs` |
| stock_balances / stock_movements / reservations / warehouses | — | — | read `inventory.read`; writes only via RPC |
| carts, cart_items | — (RPC only) | — (RPC only) | — |
| orders, order_items, order_status_events | — | own rows (events: customer-visible only) | `orders.read` |
| profiles, addresses | — | own rows | `customers.read` |
| staff_members | — | — | own row; `staff.manage` for others (no self-edit; super_admin assignment only by super_admin) |
| audit_events | — | — | `audit.read`; append-only |
| cms_pages / versions / hero_* / site_settings | published / public only | same | `cms.edit`, publish requires `cms.publish`; settings `settings.manage` |
| tryon_jobs | — | own rows (read/delete) | none by default |
| storage `tryon-inputs` / `tryon-outputs` | — | own folder (`<uid>/…`) | none by default (even super admins) |
| storage `product-media` | public read | public read | write with `products.write` |

## Tests

`npm run test:db` runs `tests/db/*.test.ts` against the local database, switching `SET LOCAL ROLE` and `request.jwt.claims` exactly like PostgREST, inside rolled-back transactions. Coverage includes anon/customer A/customer B/every staff role, aal1 vs aal2, suspended staff, horizontal and vertical escalation attempts, column-level grants, append-only ledgers, cart token misuse, storage folder ownership and a 25-connection race for the last unit. The harness refuses to run against a hosted `supabase.co` URL.
