# Payments and shipping

## Built (cash on delivery)

- `public.checkout_quote(cart_token, district)` prices the cart in Postgres: live variant prices, stock, the delivery zone for the district and the COD rule. The browser total is only an expectation: `create_order` re-quotes and refuses with `quote_changed` if anything moved.
- `public.create_order(...)` (SECURITY DEFINER, anon-callable) validates name, `+8801XXXXXXXXX` phone, district (64-district reference table), address; locks the cart; reserves and commits stock per line in variant-id order (no deadlocks); writes immutable line snapshots; converts the cart; runs risk rules; and returns an order number + tracking token. The same idempotency key always returns the same order.
- **Shipping zones** live in `public.shipping_zones` (districts list, one fallback zone, flat fee, optional free-over threshold, COD on/off, delivery estimate). The seed has two **demo** zones (Inside Dhaka ৳70 free over ৳5,000; Outside Dhaka ৳130 free over ৳8,000) that the owner must replace with real rates.
- **COD limit**: `site_settings['checkout.cod'] = {enabled, max_order_minor}` (seed: ৳20,000, placeholder).
- **Tracking**: token = HMAC-SHA256(order id, private key in `private.app_keys`), 32 chars, only its SHA-256 is stored. `track_order` needs order number + token and returns first name, masked phone, district, items, customer-visible events and courier link. No SMS/email confirmation yet, so the success page shows the private link.
- **States** are split: payment (`cod_pending → cod_collected`, `voided` on cancel/return), fulfilment (`unfulfilled → confirmed → picking → packed`, `fulfilled` automatically on courier hand-over, `cancelled`), shipment (`not_shipped → ready_for_pickup → handed_to_courier → in_transit → out_for_delivery → delivered | delivery_failed → rto → returned`), risk review. All changes go through `admin_order_transition`, which checks the permission per field, the allowed-transition matrix and cross-field guards, writes an event + audit row, and restocks on cancel/return exactly once.
- **Risk rules** (explainable signals, never an automatic ban): ≥3 orders from one phone in 24 h, same phone + same total within 15 min, high-value COD from a phone with no delivered orders, ≥2 prior returns. Medium/high holds fulfilment until a reviewer approves, verifies or rejects with a reason.
- **Couriers**: manual entry (courier, tracking number, https tracking link) per order. No courier API is called.

## Not built yet (design)

- **SSLCOMMERZ** sandbox adapter: server creates the session with the server-computed total; the browser redirect is never trusted. The IPN handler validates with SSLCOMMERZ's validation API (store ID, amount, currency BDT, `val_id`, status), dedupes on the gateway transaction ID (unique), and only then marks `paid`. Duplicate/reordered IPNs are idempotent. Credentials: `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` (server-only).
- bKash/Nagad are **not** claimed. They'd be enabled only via SSLCOMMERZ or direct merchant APIs after credentials and capability are verified.
- **Shipping settings UI**: an admin screen to edit zones/fees (the table and RLS already exist; no rates are hard-coded).
- **Couriers**: `CourierAdapter` interface (create shipment, label, tracking sync, webhook verify) with a manual adapter first; Pathao/Steadfast/RedX adapters only once account/API access is confirmed. Webhooks verified, deduped, retried; manual updates show their actor.
