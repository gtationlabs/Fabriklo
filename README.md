# Fabriklo

Bangladesh-first fashion store: Next.js storefront + secured staff console on Supabase. Current progress and launch blockers: **[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)**.

## Requirements

Node 22+, Docker (for the local Supabase stack).

## Local setup

```bash
npm install
npx supabase start          # local Postgres/Auth/REST/Storage on :54321/:54322
npx supabase db reset       # apply migrations + development seed (demo products)
cp .env.example .env.local  # then fill values from `npx supabase status`
npm run dev                 # http://localhost:3000
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the local `PUBLISHABLE_KEY`) and, for scripts/tests only, `SUPABASE_SECRET_KEY` (the local `SECRET_KEY`).

### Create a staff account (local)

```bash
npm run staff:create -- you@example.com super_admin
```

Sign in at <http://localhost:3000/admin/login>; you'll enrol an authenticator app (TOTP) on first login. Roles: `super_admin, admin, store_manager, catalog_manager, inventory_manager, order_manager, support_agent, marketing_manager, content_editor, analyst`.

### Demo accounts for testing (DEV / SANDBOX ONLY)

> ⚠️ These accounts share a **public** password. Create them only in a local or development Supabase project, never in production, and delete them before launch.

```bash
npm run seed:demo-users                    # local Supabase (127.0.0.1)
npm run seed:demo-users -- --allow-remote  # a hosted DEV project (e.g. the one in your .env.local)
npm run demo:otp -- admin                  # current 6-digit MFA code (owner | admin | manager | staff | all)
npm run seed:demo-users -- --remove        # delete all demo accounts again
```

Password for every account: **`Fabriklo-Demo-2026!`** (override with `DEMO_USERS_PASSWORD=...`).

| Account | Email | Role | Sign in at | What it can do |
| --- | --- | --- | --- | --- |
| Owner | `owner@demo.fabriklo.local` | `super_admin` | `/admin/login` | Everything, incl. security settings, integrations, super-admin assignment |
| Admin | `admin@demo.fabriklo.local` | `admin` | `/admin/login` | Runs the store; no security settings or integration secrets |
| Manager | `manager@demo.fabriklo.local` | `store_manager` | `/admin/login` | Products, stock, orders, risk, customers, analytics; no staff/settings/audit |
| Staff | `staff@demo.fabriklo.local` | `support_agent` | `/admin/login` | Read-only orders, customers and products |
| Customer | `customer@demo.fabriklo.local` | customer | `/account/login` | Storefront account with a saved Dhaka address; no admin access |

**MFA:** the admin still requires a second factor for every staff role (enforced in the database, not just the UI), so the script enrols an authenticator for each staff account itself and stores the secrets in the git-ignored `.demo-users.local.json`. After entering the password, run `npm run demo:otp -- admin` and type the code, or add the printed setup key to Google Authenticator once. Re-running the seed keeps existing secrets and resets passwords, so it is safe to run again.

If `store_manager` is missing (the `20261112000100_store_manager_role.sql` migration hasn't been applied to that project), the script uses `order_manager` for the manager account and tells you; apply migrations with `npx supabase db push` and run it again.

## Checks

```bash
npm run lint
npm run typecheck
npm test            # unit
npm run test:db     # RLS + concurrency tests against LOCAL Supabase
npm run build
npm run test:e2e    # Playwright (uses `next start`; run after build; needs SUPABASE_SECRET_KEY for fixtures)
npm run db:lint
```

## Docs

[Architecture](docs/ARCHITECTURE.md) · [Database & RLS](docs/DATABASE_AND_RLS.md) · [RBAC matrix](docs/ADMIN_RBAC_MATRIX.md) · [Inventory transactions](docs/INVENTORY_TRANSACTIONS.md) · [Store tour assets](docs/3D_TOUR_ASSETS.md) · [Security runbook](docs/SECURITY_RUNBOOK.md) · [QA plan](docs/QA_TEST_PLAN.md) · [Deployment](docs/DEPLOYMENT.md) · [Feature matrix](docs/FEATURE_MATRIX.md) · [Admin workflows](docs/ADMIN_WORKFLOWS.md) · [CMS/theme schema](docs/CMS_THEME_SCHEMA.md) · [Payments & shipping](docs/PAYMENT_AND_SHIPPING.md) · [AI try-on privacy](docs/AI_TRYON_PRIVACY.md) · [Automation rules](docs/AUTOMATION_RULES.md) · [Backup & restore](docs/BACKUP_RESTORE.md)

## Ground rules

- Never commit secrets; `.env*` is git-ignored except `.env.example`.
- Never point tests, seeds or scripts at production.
- All prices are integer poisha (`*_minor`).
- Every privileged change goes through RLS-checked queries or audited RPCs; UI hiding is not security.
