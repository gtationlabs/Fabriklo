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
| Headers | CSP/nosniff/no x-powered-by | ✅ | e2e |
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
| Load | k6 checkout + worker scripts | ⏳ | QA milestone |
