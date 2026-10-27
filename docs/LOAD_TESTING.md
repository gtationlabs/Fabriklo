# Load testing (k6)

Scripts live in `load/k6/`. They are written and reviewed but **have not been run yet**: the build sandbox could not execute the k6 binary, so the numbers below are targets, not measurements. Run them against **staging** (never production) before launch and paste the results into this file.

## Scenarios

| Script | What it does | Shape |
| --- | --- | --- |
| `browse.js` | Home → shop → JSON listing → random product page → search. The bulk of real traffic. | ramp 1→20→60 VUs over 8 min |
| `checkout.js` | Shop → add a variant to a fresh guest cart → cart → checkout → delivery quote. `PLACE_ORDERS=1` also places COD orders (scratch database only). | constant arrival rate, `RATE` shoppers/min (default 5) for `DURATION` (default 5m) |
| `admin.js` | Staff pages (overview, orders, products, inventory, risk, audit) with a real session cookie. | `VUS` (default 3) for `DURATION` (default 3m) |

Thresholds (fail the run when missed): `http_req_failed < 1%`, pages p95 < 800 ms (admin 1500 ms), JSON p95 < 400 ms, quote p95 < 600 ms. Adjust once there is a baseline.

## Running

```bash
# install: https://grafana.com/docs/k6/latest/set-up/install-k6/
BASE_URL=https://staging.example k6 run load/k6/browse.js

# checkout needs in-stock variant ids (the public listing does not expose them)
VARIANT_IDS=$(psql "$DATABASE_URL" -tAc "select string_agg(v.id::text, ',') from (select v.id from public.product_variants v join public.stock_balances s on s.variant_id = v.id where s.on_hand - s.reserved > 5 limit 20) v")
BASE_URL=https://staging.example VARIANT_IDS=$VARIANT_IDS RATE=10 k6 run load/k6/checkout.js

# admin: sign in in a browser (MFA) and copy the Supabase auth cookie
BASE_URL=https://staging.example ADMIN_COOKIE='sb-xxxx-auth-token=...' k6 run load/k6/admin.js
```

## Things the scripts will bump into (by design)

- **Per-IP rate limits**: cart and quote 60/min, listing 120/min, orders 8 per 10 min, newsletter 5 per 10 min. From one machine, `checkout.js` at more than ~1 order/min per VU is throttled with 429s. That is correct behaviour; for true load use distributed runners (k6 Cloud or several agents) or raise the limits on staging only. The limiter is shared across instances through Postgres (`rate_limit_hit`), so a multi-instance deployment does not multiply the allowance.
- **Turnstile**: if staging has Turnstile keys, `/api/checkout/orders` and `/api/newsletter/subscribe` refuse scripted requests (403 `challenge_failed`). Run with Turnstile unset on staging, or keep `PLACE_ORDERS` off.
- **Edge/WAF rules** in front of staging will show up as 403/429 too; allowlist the runner's IP for the test window and remove it afterwards.

## What to record

Fill in after each run:

| Date | Env | Script | Peak VUs / rate | p95 page | p95 API | Error rate | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _not run yet_ | | | | | | | |

Compare Supabase dashboard metrics (CPU, connections, slow queries) during the run. The expensive paths are `search_products` (catalog listing), `checkout_quote` (promotion evaluation) and `create_order` (row locks on stock); watch those first.
