# Payments and shipping (design; not built yet)

- **Cash on delivery** first. COD orders are `payment_status = 'cod_pending'`, never `paid`, until cash is recorded (`cod_collected`). High-risk COD orders go to `risk_review_status = 'needs_review'` for manual confirmation.
- **SSLCOMMERZ** sandbox adapter: server creates the session with the server-computed total; the browser redirect is never trusted. The IPN handler validates with SSLCOMMERZ's validation API (store ID, amount, currency BDT, `val_id`, status), dedupes on the gateway transaction ID (unique), and only then marks `paid`. Duplicate/reordered IPNs are idempotent. Credentials: `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` (server-only).
- bKash/Nagad are **not** claimed. They'd be enabled only via SSLCOMMERZ or direct merchant APIs after credentials and capability are verified.
- **Shipping**: zones by division/district with flat or threshold fees configured in admin; no hard-coded rates.
- **Couriers**: `CourierAdapter` interface (create shipment, label, tracking sync, webhook verify) with a manual adapter first; Pathao/Steadfast/RedX adapters only once account/API access is confirmed. Webhooks verified, deduped, retried; manual updates show their actor.
