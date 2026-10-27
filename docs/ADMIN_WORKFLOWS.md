# Admin workflows

## Available now

1. **Sign in**: `/admin/login` → password → `/admin/mfa` (enrol TOTP on first login, verify afterwards) → console. Without MFA nothing loads.
2. **Create a product**: Products → New product (always a draft) → add variants (SKU, size, colour, price in taka, optional compare-at and private cost) → Adjust stock (receive with a reason) → set Status to Active → Save. Publishing is refused until there is at least one active variant.
3. **Change price / deactivate a size**: edit in the variant row and Save (audited).
4. **Stock**: Adjust stock on a variant (receive/adjust/damage/return, reason required). Inventory page shows low/sold-out SKUs and the latest ledger entries. Adjustments above 200 units need `inventory.approve_large`.
5. **Archive**: set Status to Archived; the product disappears from the shop immediately.

## Coming with later milestones

Orders and COD confirmation, risk queue, shipments, CMS pages and hero editor, staff invitations and role changes, audit log viewer, settings.
