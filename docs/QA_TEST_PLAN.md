# QA test plan

Commands: `npm test` (unit) · `npm run test:db` (RLS/concurrency, needs local Supabase) · `npm run test:e2e` (Playwright, needs a build and local Supabase) · `npm run lint` · `npm run typecheck` · `npm run db:lint`.

Status legend: ✅ automated and passing · 🟡 partial · ⏳ not built yet.

| Area | Case | Status | Where |
| --- | --- | --- | --- |
| Catalog | Published-only visibility; draft 404 | ✅ | `tests/db/rls.test.ts`, `tests/e2e/storefront.spec.ts` |
| Catalog | Filters (size/colour/price/category/stock/sort) persist in URL | ✅ | unit `filters.test.ts`, e2e |
| Catalog | Variant availability per SKU | ✅ | db + e2e |
| Cart | Guest add / change qty / remove, server pricing | ✅ | db + e2e |
| Cart | Invalid size/qty rejected; draft variant rejected; bad token | ✅ | db + e2e |
| Cart | Cross-site POST rejected | ✅ | e2e + unit |
| Admin auth | Anonymous → login; customer → denied; aal1 staff → MFA; TOTP enrol + verify | ✅ | `tests/e2e/admin.spec.ts` |
| Admin | Product create/edit/publish/archive, variants, validation keeps input | ✅ | e2e |
| Admin | Stock receive with reason; idempotent replay; large-adjust approval | ✅ | e2e + db |
| Permissions | Every role's least-privilege cases, customer → no staff data even via direct SQL/REST | ✅ | db |
| Permissions | Support agent menus + direct URL denial | ✅ | e2e |
| Inventory | 25 concurrent last-unit reservations; expiry exactly once | ✅ | `tests/db/inventory-concurrency.test.ts` |
| Ledgers | Movements/audit cannot be edited or deleted | ✅ | db |
| Storage | Try-on photos owner-only; product-media write needs permission | ✅ | db |
| Accessibility | axe (WCAG 2.2 AA tags) on home (desktop + mobile) and checkout | 🟡 | e2e (more pages to add) |
| Headers | Nonce-based CSP (`'strict-dynamic'`, no `'unsafe-inline'` scripts, fresh nonce per response, nonce present on the page's scripts), nosniff, no x-powered-by | ✅ | `tests/e2e/storefront.spec.ts` |
| Hardening | CSP builder (dev eval only, per-integration origins, Sentry origin from DSN); Turnstile skipped when unconfigured, token required when configured, siteverify body, fails closed on outage; shared rate limiter hashes keys, uses the store only when configured, falls back to memory (not open) on failure; Sentry scrubber drops bodies/cookies/IPs and redacts emails, JWTs, Supabase keys, token query params | ✅ | `tests/unit/hardening.test.ts` |
| Hardening | `rate_limit_hit`: service_role only; fixed window with retry-after; reset after the window; purge job; rejects non-digest keys and out-of-range limits; cron job scheduled | ✅ | `tests/db/rate-limit.test.ts` |
| Hardening | Turnstile widget visible and enforced with real keys; Sentry event received with no PII | ⏳ | needs Cloudflare + Sentry accounts (staging) |
| Hero tour | Forward scroll passes scenes 1→5 in order and reverse 5→1; dots jump; skip moves focus; hidden scenes inert; desktop + mobile | ✅ | `tests/e2e/tour.spec.ts` |
| Hero tour | Reduced motion and no-JS show all 5 static panels; axe clean in tour and static modes | ✅ | e2e |
| Hero CMS | Drafts never public; publish snapshot; rollback restores; cms.edit vs cms.publish vs aal1; unsafe links/images rejected by DB | ✅ | `tests/db/hero.test.ts` |
| Hero CMS | Editor drafts → preview → publish → live → rollback | ✅ | `tests/e2e/hero-editor.spec.ts` |
| Pages CMS | Drafts never public; publish/rollback; cms.edit cannot publish or flip status; unknown block types, `<script>`, `javascript:` and reserved slugs rejected by DB | ✅ | `tests/db/pages-accounts.test.ts` |
| Pages CMS | Editor adds blocks, unsafe link refused, publish → live, rollback → gone; starter pages render; axe | ✅ | e2e |
| Accounts | Orders link to the signed-in customer; other customers see nothing and cannot derive tracking tokens; addresses private, one default; profile column grants | ✅ | db |
| Accounts | Register (weak password refused) → address → prefilled checkout (zone fee) → order in account → sign out hides it → sign in (wrong password generic) | ✅ | `tests/e2e/accounts.spec.ts` |
| Accounts | Password reset answers identically for unknown emails | ✅ | e2e |
| Accounts | Email confirmation / reset link delivery | ⏳ | needs SMTP; local Supabase runs without confirmations |
| Orders/COD | Server quote, zone fee + free threshold, COD limit, stale-total rejection, draft/oversold rejection, phone/district validation | ✅ | `tests/db/orders.test.ts` |
| Orders/COD | Idempotent replay returns same order without double stock; cancel/return restocks exactly once | ✅ | db |
| Orders/COD | State machine: pack before pickup, cash only after delivery, `paid` never settable for COD, permissions + MFA per field | ✅ | db |
| Orders/COD | 10 concurrent checkouts for the last unit → exactly 1 order, stock 0 | ✅ | `tests/db/checkout-concurrency.test.ts` |
| Orders/COD | Tracking needs order number + HMAC token; output minimised (first name, masked phone, district) | ✅ | db + e2e |
| Orders/COD | Guest checkout → success → tracking → staff fulfil → cash collected → customer sees Delivered | ✅ | `tests/e2e/checkout.spec.ts` |
| Risk | Third order from one phone in 24h flags review and blocks fulfilment until approved; reject cancels + restocks | ✅ | db |
| Payments | Online order holds stock (active reservation, expiry) instead of committing; setting off / tiny totals refused; anon cannot call begin/settle/log; status needs the tracking token | ✅ | `tests/db/payments.test.ts` |
| Payments | Settle pays only with exact amount + currency + val_id; wrong amount/currency/missing id recorded as `rejected`; stock committed once; replays (same/different val_id, later "failed") change nothing; a val_id pays one transaction only | ✅ | db |
| Payments | Failed/cancelled attempts keep the order payable with the next attempt number; gateway messages de-duplicated; late validated payment still counts | ✅ | db |
| Payments | Expiry job cancels only lapsed unpaid orders, marks attempts expired, releases stock, is idempotent; staff cancel of awaiting order releases the hold and voids payment | ✅ | db |
| Payments | Adapter: session body/URL, redirect host allow-list, validation API mapping + amount parsing, IPN `verify_sign`, provider selection rules (mock never silently in production) | ✅ | `tests/unit/payments.test.ts` |
| Payments | Mock gateway E2E: checkout → labelled mock → forged "success" return ignored → mock IPN route absent → simulated success → paid + stock committed + event trail; closed attempt disabled; staff see attempt | ✅ | `tests/e2e/payments.spec.ts` |
| Payments | Fail → retry (attempt 2) → cancel → retry (attempt 3) → success | ✅ | e2e |
| Payments | Real SSLCOMMERZ sandbox round-trip (session, hosted page, IPN, validation) | ⏳ | needs owner's sandbox credentials + public IPN URL |
| Couriers | Webhook HMAC verification, batch parsing; `courier_apply_event` dedupes, enforces transitions, auto-fulfils on hand-over, stores unknown tracking/unmapped statuses unapplied | ✅ | unit + db |
| Couriers | Unconfigured couriers and `manual` answer 404 | ✅ | e2e |
| Couriers | Real Pathao/Steadfast/RedX payloads and signatures | ⏳ | needs merchant accounts |
| AI try-on | Photo type sniffed by content; SVG/EXE refused; EXIF removed; resized ≤ 864×1296; tiny/odd/huge files refused; provider selection (mock never silently in production); FASHN request shape (base64 in/out), error classification, status polling | ✅ | `tests/unit/tryon.test.ts` |
| AI try-on | Sign-in, consent version, owned photo (exists in storage, caller's folder), supported product, one in flight, per-customer quota, site switch, credit cap; customers cannot update jobs or see others' jobs/consents | ✅ | `tests/db/tryon.test.ts` |
| AI try-on | Worker: claim once (SKIP LOCKED), event dedupe, complete only into owner's folder, ledger charged, append-only ledgers; bounded retries; expiry list/mark/purge with trace; staff stats without paths, MFA required, limits range-checked; garment attach enables product | ✅ | db |
| AI try-on | Browser (demo mock): guest must sign in; unsupported product has no panel; upload → consent gate → result → before/after → history → delete (objects + row gone, trace kept); stored input has no EXIF; anonymous cannot fetch outputs; other customer gets 404; admin page shows mock label + limits save; worker route 404 without secret | ✅ | `tests/e2e/tryon.spec.ts` |
| AI try-on | Real FASHN run (key, real garment photo, pose/moderation errors) | ⏳ | needs owner's FASHN key |
| Coupons | Min basket, case-insensitive code, redemption limit under lock, one-per-customer and first-order re-checked with the order's phone (hint `coupon_invalid`), category scope, deterministic stacking (coupon first, priority, stackable), free delivery, 15-attempt throttle; staff RLS + MFA; redemption count not editable | ✅ | `tests/db/marketing.test.ts` |
| Consent | Double opt-in: marketing suppressed until confirmed, transactional flows, duplicate signup not resent, unsubscribe link suppresses; account opt-out writes consent events + suppression and opt-in lifts it | ✅ | db |
| Automation | Order emits each event once (status-event replay deduped); live rule queues exactly one message, reprocessing never sends twice; conditions, dry-run, hourly quota, consent-aware marketing action (suppressed + visible), review task flags the order | ✅ | db |
| Automation | Rule validation: unknown template, bad op, webhook host not allowlisted / http / IP / lookalike refused; allowlist edit needs `automation.manage`; versions recorded; support cannot write | ✅ | db |
| Outbox | Claim (SKIP LOCKED, suppressed never claimed), retry with backoff, dead after max attempts, staff retry (permission), low-stock event once per day, campaign reaches only opted-in members | ✅ | db |
| Messaging | Template rendering (allow-listed placeholders, no interpretation, control chars stripped), provider selection (mock never silently in production), webhook target guard (https/allowlist/IP/internal/lookalike), HMAC signing + freshness, no redirects, failure classification; consent cookie parsing; attribution capture bounds | ✅ | `tests/unit/marketing.test.ts` |
| Marketing E2E | Staff create coupon + live rule via UI; webhook to unlisted host refused in UI; guest: wrong code message, coupon applied, discount shown, order placed with discount + redemption; confirmation email sent once through the labelled mock (outbox preview, execution history, rule tester, coupon redemption count) | ✅ | `tests/e2e/marketing.spec.ts` |
| Marketing E2E | Newsletter footer → mock confirm mail → bad token refused → confirm → unsubscribe link → suppression; worker endpoint 404 without secret | ✅ | e2e |
| Marketing E2E | Consent banner: essential-only stores no attribution; accept-all captures UTM cookie; banner not shown again | ✅ | e2e |
| Theme | Token set rejected on extra keys / bad hex / unknown font / radius (Zod + SQL); CSS emitted only from validated tokens; WCAG contrast pairs flagged; visitors read the published version only; editor drafts, only theme.publish publishes/rolls back; versions immutable; audited; aal1 refused | ✅ | `tests/unit/admin-settings.test.ts`, `tests/db/admin-settings.test.ts` |
| Staff | Only staff.manage lists/finds users; list exposes email + MFA facts, no secrets; last active super admin cannot be suspended/demoted/deleted (even by the DB owner); admin cannot assign super_admin or edit self; MFA reset of a super admin needs a super admin and is audited under the actor; invited member has no permissions until first aal2 session activates them (audited) | ✅ | db |
| Audit viewer | Facets/actors need audit.read; masking of secret-looking keys at any depth; changed-key diff; filter parsing never throws; CSV masked + formula-safe | ✅ | unit + db |
| Settings | Each key validated in SQL (name length/brackets, currency fixed, BD phone, COD limit bounds and types, hold minutes, unknown keys/extra fields refused); public vs private visibility; audit before/after; COD limit flows into `checkout_quote`; zone save: district taken, empty active zone, bad district characters, fee CHECK, fallback swap in one statement, cannot drop the only fallback, fee change visible to anon; no settings.manage → 42501 | ✅ | db |
| Admin E2E | Theme: draft → scoped preview + contrast warning → draft-only preview page → publish changes the live store's CSS variables and font → second version → roll back → defaults republished; content editor sees no publish form | ✅ | `tests/e2e/admin-settings.spec.ts` |
| Admin E2E | Settings: store name on storefront header/title, invalid name refused, COD limit bounds, zone fee change reflected in checkout quote, duplicate district refused, demo warning cleared; audit log filtered + CSV; support agent denied Settings/Audit | ✅ | e2e |
| Admin E2E | Staff: invite → one-time link → accept → weak password refused → password → MFA enrol → active in list → order manager denied Staff → suspend locks out on next request → reactivate → MFA reset removes factors; events audited under the admin; own row locked | ✅ | e2e |
| Photos | WebP re-encode within 2000 px, metadata stripped; small kept; non-image / undecodable / tiny / extreme aspect / >10 MB refused; bucket vs local URLs | ✅ | `tests/unit/media.test.ts` |
| Photos | Staff cannot insert `product_media` directly; RPC adds with audit; variant must belong to product; card picks first photo; reorder needs the full set; delete returns the path; last garment removal disables try-on | ✅ | `tests/db/inventory-ops.test.ts` |
| Purchase orders | Draft needs `inventory.adjust`; validation; re-save replaces lines; receive refused on draft; partial → received moves stock once; replay with same key is a no-op; over-receive refused; cost visible only with `products.costs`; cancel keeps received stock | ✅ | db |
| Transfers | Same-warehouse refused; send needs available stock (reservations respected); sent → received moves stock exactly once; cancelling in transit returns stock; bad transitions refused | ✅ | db |
| Admin E2E | Photos: upload two → thumbnails load from the bucket → bad file skipped with reason → reorder → alt edit → storefront card + gallery show them → remove deletes the object | ✅ | `tests/e2e/inventory-ops.spec.ts` |
| Admin E2E | PO: draft with SKU search → ordered → receive 3 then 4 → on-hand +7 → transfer 5 to the backroom: in transit (source −5) → received (destination +5) | ✅ | e2e |
| Inventory | Cycle counts | ⏳ | not built |
| Messaging | Real SMTP delivery, SMS gateway, WhatsApp template, signed webhook received by a real endpoint | ⏳ | needs credentials / receiver |
| Load | k6 browse / checkout / admin scenarios | 🟡 | scripts in `load/k6/`, not executed yet (`docs/LOAD_TESTING.md`) |
| Backup | Backup + restore drill with row-count verification | ✅ | `scripts/restore-drill.sh`, run locally 2026-10-26 (`docs/BACKUP_RESTORE.md`) |
