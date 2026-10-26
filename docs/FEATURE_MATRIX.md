# Feature matrix

Legend: ✅ built and tested · 🟡 partial · 🧱 schema/RLS only · ⏳ planned · 🔌 needs provider credentials

| Feature | Status | Notes |
| --- | --- | --- |
| Product listing, filters, sort, pagination, search | ✅ | `/shop`, `/men`, `/women`, `/category/[slug]`, `/collections/[slug]`, `/search` |
| Product detail with real SKU/size/colour, availability | ✅ | Placeholder art (no product photos supplied yet) |
| Guest cart | ✅ | Capability-token cart, server pricing |
| Homepage | 🟡 | Static first scene + sections; scroll tour next |
| 2.5D scroll store tour | ⏳ | Hero milestone (schema 🧱 ready) |
| Staff login + mandatory TOTP MFA | ✅ | aal2 enforced in DB |
| Admin product CRUD + variants + costs | ✅ | Media upload ⏳ |
| Inventory: ledger, adjustments, alerts, reservations | ✅ | Purchase orders/transfers/cycle counts ⏳ |
| Orders + COD checkout | 🧱 | Tables/RLS ready; create-order RPC next |
| Order tracking (customer-safe token) | 🧱 | `tracking_token_hash` column ready |
| Risk review queue | 🧱 | `risk_review_status` column ready |
| SSLCOMMERZ sandbox | ⏳ 🔌 | Store ID/password needed |
| Couriers (Pathao/Steadfast/RedX) | ⏳ 🔌 | Manual tracking first |
| CMS pages / theme editor | 🧱 | Pages, versions, hero scenes, settings tables |
| Marketing, coupons, automations | ⏳ | |
| AI try-on (FASHN) | 🧱 🔌 | Private buckets + job table ready; worker/provider later |
| Customer accounts (sign-up, addresses, orders) | 🧱 | Tables + RLS ready; UI later |
| Audit log | ✅ | Viewer UI ⏳ |
| CI | ✅ | Lint, unit, audit, DB lint, RLS tests, typecheck, build, E2E |
