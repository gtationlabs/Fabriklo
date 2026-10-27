# Marketing, coupons and automation

Slice 7. Migration `0013_marketing_automation`. Everything that decides money (discounts) or consent (who may be messaged) is decided in Postgres; the Next.js server only renders, rate-limits and dispatches.

## Coupons and automatic discounts

- Table `promotions` (`kind` coupon | automatic). Fields: discount type (percent with optional cap, fixed amount in poisha, free delivery), scope (whole order, categories, collections, variants) with target ids, minimum basket, first-order-only, one-use-per-customer, start/end, redemption limit, priority, stackable, active. Codes are stored upper-case and matched case-insensitively. `redemption_count` can only be moved by `create_order` (trigger guard).
- **Evaluation** (`private.evaluate_promotions`): the cart's coupon (if any) is considered first, then active automatic promotions by `(priority, id)`. A promotion applies when nothing applied yet, or when it and everything already applied are stackable. Percentages are computed on the eligible subtotal (never compounded); the total discount is capped at the subtotal; free delivery zeroes the delivery fee. The result is deterministic for a given cart, so quotes and orders agree.
- **Customer identity**: first-order and one-use rules check account id, phone and email. At quote time a guest's phone is unknown, so the quote may say "applied"; `create_order` re-evaluates with the phone/email from the form and refuses with hint `coupon_invalid` (the UI drops the code and reloads the total).
- **Atomicity**: `create_order` locks the promotion rows (`FOR UPDATE`), re-checks the redemption limit, increments `redemption_count`, writes `coupon_redemptions` (one per promotion per order, append-only) and stores `orders.discount_minor` + `orders.coupon_code`. Concurrent checkouts cannot exceed `max_redemptions`.
- Customer RPCs: `cart_apply_coupon(token, code)` (15 attempts / 10 min per cart in the DB, plus 20 / 10 min per IP in the API route) and `cart_remove_coupon`. The quote returns `promotions` (applied list), `coupon` (status + reason) and `discount_minor`.
- Admin → Marketing → Coupons & discounts: CRUD through RLS (`marketing.manage`, MFA), audited; redemptions listed per promotion. Promotions with redemptions cannot be deleted (deactivate instead).

## Consent, newsletter and suppression

- `newsletter_subscriptions` with **double opt-in**: `POST /api/newsletter/subscribe` (same-origin, 5 / 10 min / IP, honeypot) calls `newsletter_subscribe` (service role) which stores a hashed confirm token and queues a *transactional* `newsletter_confirm` email. The API always answers the same way, so it cannot be used to check who is subscribed; re-subscribing within an hour does not resend. `/newsletter/confirm?token=` → subscribed + `consent_events` (granted). `/newsletter/unsubscribe?token=` → unsubscribed + `unsubscribes` row + account opt-in cleared. Marketing emails carry a per-address unsubscribe link (HMAC-derived token, hash registered via `newsletter_unsubscribe_token_set`) and `List-Unsubscribe` headers.
- `profiles.marketing_opt_in` (account page) is mirrored by a trigger into `consent_events` and the `unsubscribes` suppression list (`all` channels when opted out).
- **Policy** (`private.marketing_allowed`): a *marketing* message goes out only to someone who is opted in (account flag or confirmed newsletter) and not suppressed on that channel. *Transactional* messages (order confirmation, payment received, delivery updates, newsletter confirmation) do not require opt-in and are not blocked by the marketing suppression list; a channel suppression `all` + marketing is always blocked. Every refused message is stored in the outbox as `suppressed` with the reason, so nothing disappears silently.
- Admin → Newsletter: lists by status, CSV export of confirmed subscribers (`marketing.manage`), suppression list management.

## Events

`marketing_events` is an append-only, de-duplicated stream (`dedupe_key` unique). Emitters:

| Trigger | Source | Dedupe key |
|---|---|---|
| `order.placed`, `cod.awaiting_verification`, `payment.verified`, `order.packed`, `order.delivered`, `delivery.failed`, `return.requested` | trigger on `order_status_events` | `order:{id}:{type}` |
| `tryon.completed`, `tryon.failed` | trigger on `tryon_jobs` (no photo paths in payload) | `tryon:{job}:{status}` |
| `stock.low` (available crosses the reorder point downwards), `stock.back_in_stock` | trigger on `stock_balances` | per variant per day |
| `customer.signup` | trigger on `profiles` insert | `signup:{uid}` |
| `cart.abandoned` (signed-in carts idle 1 h–7 d), `summary.weekly` (Mondays) | `private.emit_scheduled_marketing_events()` via pg_cron every 30 min | per cart / per ISO week |

The payload holds order/product facts (number, totals, district, payment method, SKU, counts), never addresses or photos.

## Automation rules

`automation_rules`: `trigger_type` → `conditions` (JSON array of `{field, op, value}`; ops `eq neq gt gte lt lte in contains exists not_exists`; fields are event columns and payload keys) → one `action` (JSON). Rules are **data, never code**. Fields: `is_active`, `mode` (`dry_run` | `live`), `quota_per_hour`, `version` (bumped on every behavioural change, snapshot kept in `automation_rule_versions`), `owner_id`, `last_triggered_at`. A BEFORE trigger validates everything: action type, template existence, staff address for staff mail, triggers without a customer cannot target "customer", **webhook URL must be https on an allowlisted host** (`site_settings['automation.webhook_allowlist']`, edited under Integrations by `automation.manage`; IPs, localhost, `.internal`/`.local` are always refused).

Actions: `email` (to customer or a staff address, template key, message class), `sms`, `whatsapp` (template keys), `internal_alert`, `notify_inventory` (outbox rows on the `internal` channel, visible in the outbox), `review_task` (flags the order `needs_review` with a status event), `webhook` (signed POST).

**Processing** (`automation_process_events`, service role; run by the worker): for each unprocessed event and each active rule of that trigger, `private.automation_apply` writes exactly one `automation_executions` row per `(rule, event)` (unique constraint = idempotency): `skipped` (conditions, quota, duplicate, suppressed with reason), `dry_run`, or `queued` with the outbox id. Recipients are stored masked. Reprocessing an event, or a duplicate status event, never sends twice (event dedupe + execution uniqueness + outbox `dedupe_key`).

Admin → Automation rules: list with 24 h decision counts, pause/resume, editor (conditions builder, action fields), **Test against recent events** (`automation_test_rule`: match + masked recipient + consent, nothing written), execution history, versions.

## Outbox and delivery

`notification_outbox` holds every outbound message: channel, class, recipient, template, payload, status (`queued → sending → sent | failed → queued (backoff 1,2,4,…min) | dead` after `max_attempts`, or `suppressed`), provider and provider message id, errors. Internal alerts are `sent` on insert.

Worker (`lib/automation/service.ts#runAutomationTick`, service role, single-flight): processes events, then `outbox_claim` (SKIP LOCKED) → render template → provider → `outbox_mark_sent` (stores a text preview for staff) / `outbox_mark_failed`. It runs after every checkout and newsletter signup (`after()`), from Admin → "Run automation now", and from `POST /api/automation/worker` (`Authorization: Bearer $AUTOMATION_WORKER_SECRET`, 404 without it) for a scheduler. Staff can retry `dead`/`failed` rows (`admin_outbox_retry`, audited); suppressed rows cannot be forced.

Templates (`email_templates`, `sms_templates`, `whatsapp_templates`) are **plain text with `{{placeholders}}`** from an allow-list (`store_name, order_number, customer_name, total, …, confirm_url, unsubscribe_url`); unknown placeholders render empty, values are never interpreted, HTML tags are refused by the editor. Marketing emails get the unsubscribe link appended if the template lacks it.

Providers (`lib/notify/providers.ts`, selection in `select.ts`):

| Channel | Live | Mock | Production without config |
|---|---|---|---|
| Email | SMTP via nodemailer (`SMTP_URL`, `SMTP_FROM`) | outside production or `NOTIFY_ALLOW_MOCK=true`; delivers nothing, outbox keeps a preview | row dead-lettered with "email provider not configured" |
| SMS | generic HTTP gateway stub (`SMS_GATEWAY_URL`, `SMS_API_KEY`) — **not verified against any Bangladesh gateway** | same | dead-lettered |
| WhatsApp | Meta Cloud API template send (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) — **not verified against a live account** | same | dead-lettered |
| Webhook | always real HTTP; https only, host allowlist re-checked at send time, no redirects, 10 s timeout, `X-Fabriklo-Signature: v1=HMAC-SHA256(secret, "{ts}.{body}")`, `X-Fabriklo-Timestamp`, `X-Fabriklo-Delivery`; attempts logged in `webhook_events` | — | sent unsigned if `WEBHOOK_SIGNING_SECRET` is missing (set it) |

The admin shows which provider is selected and labels mocks ("MOCK providers deliver nothing"). Nothing claims a mock is live.

## Campaigns, segments, banner, integrations, attribution

- `customer_segments` (definition: has_ordered, min_orders, last_order_days) resolve to opted-in, non-suppressed people (`private.segment_members`); `admin_segment_count` previews reach. `campaigns` (email/SMS, segment, marketing-class template, UTM) → `admin_campaign_send` queues one outbox row per member (dedupe per campaign + recipient), records queued/suppressed counts.
- Announcement banner: `site_settings['marketing.banner']` (public, text + site path + dates) rendered above the header.
- `integration_connections`: status, public ids (pixel id, GA4 measurement id, from address) and the **name** of the environment secret; a guard refuses secret-looking values. The admin shows whether the named variable is present in the server environment, never its value.
- Cookie consent (`fbk_consent`, client-side only): essential cookies need no consent; GA4 loads with *analytics*, the Meta Pixel with *marketing*, and only when `NEXT_PUBLIC_GA4_MEASUREMENT_ID` / `NEXT_PUBLIC_META_PIXEL_ID` are set (CSP extended automatically). First-touch UTM/landing/referrer is captured into `fbk_utm` **only with analytics consent** and written to `attribution_events` by `create_order`. The marketing overview labels attribution as a lower bound and shows how many orders have none.

## Not built / limits

- SMS and WhatsApp adapters are shaped but untested against real gateways; Meta CAPI server-side events are not sent (token field reserved).
- Abandoned-cart events exist only for signed-in customers (guests have no contact details).
- No A/B testing, no customer-facing "notification preferences" beyond the account opt-in and unsubscribe links (per-channel preferences are a later addition).
- Rate limits in the API routes are per server instance; the database limits (coupon attempts per cart) hold across instances.
