# Feature matrix

Legend: ✅ built and tested · 🟡 partial · 🧱 schema/RLS only · ⏳ planned · 🔌 needs provider credentials

_Last updated: 2026-10-26 (after slice 9). `IMPLEMENTATION_STATUS.md` has the detail and the launch blockers._

| Feature | Status | Notes |
| --- | --- | --- |
| Product listing, filters, sort, pagination, search | ✅ | `/shop`, `/men`, `/women`, `/category/[slug]`, `/collections/[slug]`, `/search` |
| Product detail with real SKU/size/colour, availability | ✅ | Placeholder art (no product photos supplied yet) |
| Guest cart | ✅ | Capability-token cart, server pricing |
| Homepage with 2.5D scroll store tour | ✅ | Five owner renders, GSAP ScrollTrigger, reduced-motion / no-JS fallbacks |
| Hero tour editor with draft → preview → publish → rollback | ✅ | Admin → Content & hero |
| Content pages (block editor, versions, templates) | ✅ | Allow-listed blocks in Zod + SQL; legal pages are templates to replace |
| Storefront theme (colours, fonts, radius) with versions | ✅ | Closed token set; Admin → Content → Theme |
| Store name, tagline, contact as settings | ✅ | Admin → Settings; brand not inferred from the renders |
| Staff login + mandatory TOTP MFA | ✅ | aal2 enforced in DB |
| Staff management (invite link, roles, suspend, MFA reset) | ✅ 🔌 | Invite/reset links shown once (no email sent); needs `SUPABASE_SECRET_KEY` |
| Admin product CRUD + variants + costs | ✅ | Product photos ⏳ (none supplied) |
| Inventory: ledger, adjustments, alerts, reservations | ✅ | Purchase orders/transfers/cycle counts ⏳ |
| Orders + cash-on-delivery checkout | ✅ | Atomic stock commit, state machine, risk rules |
| Order tracking (customer-safe token) | ✅ | `/orders/track` + account history |
| Risk review queue | ✅ | Explainable rules, no automatic "fraud" label |
| Online payment (SSLCOMMERZ) | ✅ 🔌 | Adapter + server-side validation built; real sandbox run pending credentials; labelled mock otherwise |
| Couriers (Pathao/Steadfast/RedX) | 🟡 🔌 | Manual tracking; signed webhook stubs; no label creation |
| Customer accounts (sign-up, addresses, orders) | ✅ 🔌 | Auth emails need SMTP in Supabase Auth |
| AI try-on (FASHN) | ✅ 🔌 | Private pipeline built; real API run pending key; labelled demo mock otherwise |
| Coupons and automatic promotions | ✅ | Evaluated and redeemed only in the DB |
| Newsletter double opt-in, consent, suppression | ✅ 🔌 | Real delivery needs `SMTP_URL` |
| Automation rules (as data), outbox, webhooks | ✅ 🔌 | Dry-run, quotas, idempotent; SMS/WhatsApp adapters unverified |
| Analytics tags (GA4, Meta Pixel) behind consent | ✅ 🔌 | Need the public ids |
| Shipping zones, COD limit, online hold settings | ✅ | Admin → Settings; demo values until the owner confirms |
| Audit log viewer + CSV | ✅ | Masked secrets, filters, keyset paging |
| CI | ✅ | Lint, unit, audit, DB lint, RLS tests, typecheck, build, E2E |
| Nonce-based CSP, shared rate limiting, global staff sign-out | ✅ | Slice 9 |
| Cloudflare Turnstile (4 forms) | ✅ 🔌 | Wired + unit-tested; inactive until both keys are set |
| Sentry error monitoring (PII scrubbed) | ✅ 🔌 | Wired; inactive until DSNs are set; source maps not uploaded |
| WAF / edge rate rules | ⏳ | Rule list written in `SECURITY_RUNBOOK.md`; configured on the zone by the owner |
| Load tests (k6) | 🟡 | Scripts written; not executed yet |
| Backup + restore drill | ✅ | Scripts + local drill done; production PITR to enable |
