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
| Accessibility | axe (WCAG 2.2 AA tags) on home, desktop + mobile | 🟡 | e2e (more pages to add) |
| Headers | CSP/nosniff/no x-powered-by | ✅ | e2e |
| Hero tour | Forward/reverse scroll, skip, reduced motion, screenshots | ⏳ | hero milestone |
| Orders/COD | Create order, state machine, tracking token | ⏳ | order milestone |
| Payments | SSLCOMMERZ IPN replay/mismatch/invalid | ⏳ | payment milestone |
| AI try-on | Upload validation, consent, quotas, deletion | ⏳ | try-on milestone |
| Load | k6 checkout + worker scripts | ⏳ | QA milestone |
