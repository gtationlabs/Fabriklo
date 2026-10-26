# Payments and shipping

## Cash on delivery (slice 2)

- `public.checkout_quote(cart_token, district)` prices the cart in Postgres: live variant prices, stock, the delivery zone for the district and the COD rule. The browser total is only an expectation: `create_order` re-quotes and refuses with `quote_changed` if anything moved.
- `public.create_order(...)` (SECURITY DEFINER, anon-callable) validates name, `+8801XXXXXXXXX` phone, district (64-district reference table), address; locks the cart; reserves stock per line in variant-id order (no deadlocks); writes immutable line snapshots; converts the cart; runs risk rules; and returns an order number + tracking token. The same idempotency key always returns the same order. For COD the reservation is committed at once.
- **Shipping zones** live in `public.shipping_zones` (districts list, one fallback zone, flat fee, optional free-over threshold, COD on/off, delivery estimate). The seed has two **demo** zones (Inside Dhaka ৳70 free over ৳5,000; Outside Dhaka ৳130 free over ৳8,000) that the owner must replace with real rates.
- **COD limit**: `site_settings['checkout.cod'] = {enabled, max_order_minor}` (seed: ৳20,000, placeholder).
- **Tracking**: token = HMAC-SHA256(order id, private key in `private.app_keys`), 32 chars, only its SHA-256 is stored. `track_order` needs order number + token and returns first name, masked phone, district, items, customer-visible events and courier link. No SMS/email confirmation yet, so the success page shows the private link.
- **States** are split: payment (`cod_pending → cod_collected`, `awaiting_payment → paid`, `voided` on cancel/return, `failed` on expiry), fulfilment (`unfulfilled → confirmed → picking → packed`, `fulfilled` automatically on courier hand-over, `cancelled`), shipment (`not_shipped → ready_for_pickup → handed_to_courier → in_transit → out_for_delivery → delivered | delivery_failed → rto → returned`), risk review. All staff changes go through `admin_order_transition`, which checks the permission per field, the allowed-transition matrix and cross-field guards, writes an event + audit row, and restocks on cancel/return exactly once.
- **Risk rules** (explainable signals, never an automatic ban): ≥3 orders from one phone in 24 h, same phone + same total within 15 min, high-value COD from a phone with no delivered orders, ≥2 prior returns. Medium/high holds fulfilment until a reviewer approves, verifies or rejects with a reason.

## Online payment: SSLCOMMERZ (slice 5)

Migration `0011_payments_couriers`. Provider-agnostic in code (`lib/payments/types.ts`), SSLCOMMERZ first.

### Flow

1. Checkout with "Pay online" calls `create_order(..., 'sslcommerz', ...)`. The order is created with `payment_status = 'awaiting_payment'` and each line's stock is **held** (`inventory_reservations`, `expires_at = now() + site_settings['checkout.online'].hold_minutes`, 10–120, seed 30) rather than committed. Requires `site_settings['checkout.online'].enabled` and a total ≥ ৳10.
2. The server (service role, `lib/payments/service.ts#startPayment`) calls `payment_begin(order_number, tracking_token, provider)`, which creates a `payment_transactions` row with `tran_id = <order number>-<attempt>` and the **server-side total**, then creates the gateway session (`POST /gwprocess/v4/api.php` with `store_id`, `store_passwd`, `total_amount`, `currency=BDT`, `tran_id`, success/fail/cancel/IPN URLs, customer and shipping fields) and records the session key. The customer is redirected to the gateway URL only if it is on an `*.sslcommerz.com` host.
3. **Nothing the browser brings back is trusted.** `/api/payments/sslcommerz/return?outcome=success|fail|cancel` and `/api/payments/sslcommerz/ipn` both feed `processGatewayMessage`, which:
   - logs every message as a `payment_events` row with a de-duplication key (`kind:tran_id:sha256(body)`); a repeated message returns early;
   - for IPNs, checks `verify_sign` (md5 over the `verify_key` fields sorted by name plus `store_passwd=md5(password)`); a bad signature is logged as `rejected`;
   - for a VALID/VALIDATED claim, calls the **validation API** (`/validator/api/validationserverAPI.php?val_id&store_id&store_passwd&format=json`) and only then calls `payment_settle(tran_id, 'valid', amount_minor, currency, val_id, bank_tran_id, card_type, risk_level, payload)`;
   - for FAILED/CANCELLED/EXPIRED/UNATTEMPTED, settles the attempt as failed/cancelled (idempotent; never pays).
4. `payment_settle` (service role only) is the **only** path to `paid`. It re-checks amount and currency against the transaction, refuses a `val_id` already used by another transaction (`gateway_val_id` is unique), marks the transaction valid, commits the held stock (or re-reserves it if the hold had lapsed), moves the order to `paid` with a customer-visible `gateway` event, and flags the order for review when stock turned out short or the gateway reported `risk_level = 1`. Amount mismatches and replayed ids are recorded as `rejected` events and the order stays unpaid. Replays of a settled transaction change nothing.
5. The customer lands on `/order/payment`, which reads `payment_status(order_number, token)` from the database: *Payment received*, *Payment not completed* (with **Try paying again** → `payment_begin` attempt n+1, max 20), *Waiting for your payment*, or *This order has expired*.
6. `expire_unpaid_orders(grace)` (pg_cron, every 5 min, 15-min grace after the hold) cancels awaiting orders whose hold lapsed, marks their attempts `expired` and voids nothing that was paid. Staff cancelling an awaiting order releases the hold (no restock movement) and voids the payment via trigger. A payment validated **after** the hold expired still counts (the money moved): stock is re-reserved or the order is flagged for staff.

### Mock provider (local/E2E only)

With no `SSLCOMMERZ_STORE_ID`/`SSLCOMMERZ_STORE_PASSWORD`, and only outside production (or with `PAYMENTS_ALLOW_MOCK=true`, used by the Playwright server), a **sandbox mock gateway** is selected. It is labelled "Sandbox mock gateway (not a real payment)" on the checkout page, the mock page (`/pay/mock/[tranId]`), the result page and the admin order page. Its buttons post a fake notification through the same validation and settlement path. It moves no money and is never presented as live. Because it has no secret, anyone who can reach a mock deployment can "pay"; that is why it cannot run in production without the explicit flag.

### Not verified yet

- The SSLCOMMERZ adapter is written against the public v4 documentation and unit-tested with stubbed HTTP. It has **not** been run against the real sandbox: that needs the owner's sandbox store ID/password set in the host's secret store (`SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_SANDBOX=true`) and a public URL for the IPN. First real run: place a test order, pay with a sandbox card, confirm the IPN arrives and the order shows `paid` with a `validation` event.
- `verify_sign` is checked as documented by the community (the official docs do not spell out the algorithm); if a real IPN fails the check, the event is logged as `bad_signature` and the validation API still decides.
- Refunds through the gateway are not built; `paid → refunded` exists in the state matrix but is not exposed in the admin until a refund flow (with `orders.refund`) exists.
- bKash/Nagad are **not** claimed. They appear only as payment options inside the SSLCOMMERZ hosted page if the merchant account enables them.

## Couriers (slice 5)

- `lib/couriers/types.ts` defines `CourierAdapter` (configured?, verify webhook, parse events, map status). `manual` is the default: staff enter courier, tracking number and link, and move the shipment status by hand.
- `pathao`, `steadfast`, `redx` are **signed-webhook stubs**: `POST /api/couriers/[courier]/webhook` verifies HMAC-SHA256 over the raw body with `<COURIER>_WEBHOOK_SECRET` (header `x-webhook-signature`, `x-signature` or `x-hub-signature-256`), parses single or batched JSON events, maps the courier's status names to ours, and calls `courier_apply_event`, which stores every event once (`unique (courier, event_id)`), applies only allowed shipment transitions (writing a `courier` actor event; hand-over marks the order fulfilled; `returned` restocks and voids COD), and keeps unknown tracking numbers or unmapped statuses for staff without applying them. Until a secret is configured the endpoint answers 404.
- These three adapters are **not verified against live APIs**: the real signature scheme, header and payload shape must be confirmed when merchant accounts exist. Creating shipments and fetching labels through courier APIs is not built.
