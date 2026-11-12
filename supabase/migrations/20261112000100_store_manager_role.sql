-- A general "store manager" role: runs day-to-day operations across catalogue,
-- stock and orders without access to staff, settings, integrations or the audit log.
insert into public.staff_roles (code, name, description, rank) values
  ('store_manager', 'Store manager', 'Day-to-day operations: products, stock, orders, risk and customers', 70)
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code)
select 'store_manager', code from public.permissions
where code in (
  'analytics.read', 'analytics.export',
  'products.read', 'products.write', 'products.costs',
  'inventory.read', 'inventory.adjust',
  'orders.read', 'orders.fulfill', 'orders.cancel',
  'risk.review',
  'customers.read',
  'cms.edit',
  'marketing.read'
)
on conflict do nothing;
