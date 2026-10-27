# Admin RBAC matrix

Source of truth: `public.role_permissions` (seeded in `supabase/migrations/20261026000100_foundation_identity_rbac.sql`). Every permission additionally requires an **active** staff record and an **aal2 (MFA-verified)** session.

| Permission | super_admin | admin | catalog | inventory | orders | support | marketing | content | analyst |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| analytics.read | ✓ | ✓ | ✓ (limited*) | ✓ (limited*) | ✓ | — | ✓ | — | ✓ |
| analytics.export | ✓ | ✓ | — | — | — | — | — | — | ✓ |
| products.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| products.write | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| products.costs | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — |
| inventory.read | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| inventory.adjust | ✓ | ✓ | — | ✓ | — | — | — | — | — |
| inventory.approve_large | ✓ | ✓ | — | — | — | — | — | — | — |
| orders.read | ✓ | ✓ | — | — | ✓ | ✓ | — | — | — |
| orders.fulfill | ✓ | ✓ | — | — | ✓ | — (limited: read only) | — | — | — |
| orders.cancel | ✓ | ✓ | — | — | ✓ | — | — | — | — |
| orders.refund | ✓ | ✓ (permission) | — | — | — (grant explicitly) | — | — | — | — |
| risk.review | ✓ | ✓ | — | — | ✓ | — (limited: read only via orders.read) | — | — | — |
| customers.read | ✓ | ✓ | — | — | ✓ | ✓ | — | — | — |
| customers.manage | ✓ | ✓ | — | — | — | — | — | — | — |
| cms.edit / cms.publish | ✓ | ✓ | — | — | — | — | — | ✓ | — |
| theme.publish | ✓ | ✓ (permission) | — | — | — | — | — | — | — |
| marketing.manage | ✓ | ✓ | — | — | — | — | ✓ | — | — |
| marketing.read | ✓ | ✓ | — | — | — | — | ✓ | — | ✓ (view only) |
| automation.manage | ✓ | ✓ | — | — | — | — | ✓ | — | — |
| integrations.read | ✓ | ✓ | — | — | — | — | ✓ (metadata) | — | — |
| integrations.manage | ✓ | — (restricted) | — | — | — | — | — | — | — |
| settings.manage | ✓ | ✓ | — | — | — | — | — | — | — |
| settings.security | ✓ | — | — | — | — | — | — | — | — |
| staff.manage | ✓ | ✓ (cannot grant super_admin) | — | — | — | — | — | — | — |
| audit.read | ✓ | ✓ | — | — | — | — | — | — | — |
| tryon.manage | ✓ | ✓ | — | — | — | — | — | — | — |

\* "limited" analytics: catalog/inventory dashboards will scope to catalogue and stock KPIs (sales figures hidden) when the analytics milestone lands.

Notes
- `orders.refund` is deliberately **not** given to `order_manager` by default; the owner grants it explicitly (spec: "permission").
- Hidden menus are not authorization. Each page calls `requireStaff(permission)`, each action calls `checkStaff(permission)`, and each table/RPC checks `private.has_permission()`.
- Role changes are audited (`audit_events`), staff cannot edit their own membership, and suspensions are effective immediately (no cached claims). Forced session revocation on role change will be added with the staff-management UI (Auth admin `signOut(user, 'global')`).
