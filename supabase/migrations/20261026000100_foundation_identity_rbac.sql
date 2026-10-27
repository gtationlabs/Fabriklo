-- =============================================================================
-- Fabriklo 0001: foundation, identity, RBAC, audit
-- Fail-closed defaults: nothing in `public` is reachable by anon/authenticated
-- unless a later statement grants it explicitly AND an RLS policy allows it.
-- =============================================================================

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Internal helpers live in `private`, which is NOT exposed through the Data API
-- (see supabase/config.toml [api].schemas). Roles need USAGE so RLS policies that
-- call these helpers can run, but they cannot be reached over REST.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- Fail closed for everything created later in public/private by the migration owner.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
-- The trusted server role (secret key; workers/scripts only) keeps table access.
-- It bypasses RLS, so it must never reach the browser. Append-only triggers still apply.
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Prevent UPDATE/DELETE on append-only ledgers, even for the table owner.
create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'table %.% is append-only; write a compensating entry instead',
    tg_table_schema, tg_table_name
    using errcode = '42501';
end;
$$;

-- -----------------------------------------------------------------------------
-- RBAC: permissions, roles, staff members
-- Role assignments are server-controlled rows. user_metadata is never trusted.
-- -----------------------------------------------------------------------------
create table public.permissions (
  code text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);

create table public.staff_roles (
  code text primary key check (code ~ '^[a-z_]+$'),
  name text not null,
  description text not null default '',
  rank int not null default 0
);

create table public.role_permissions (
  role_code text not null references public.staff_roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);
create index role_permissions_permission_idx on public.role_permissions(permission_code);

create table public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_code text not null references public.staff_roles(code),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  display_name text not null default '' check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index staff_members_role_idx on public.staff_members(role_code);
create trigger staff_members_updated_at before update on public.staff_members
  for each row execute function private.set_updated_at();

-- MFA: true only when the current JWT was issued after a verified second factor.
create or replace function private.is_mfa_verified()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2';
$$;

-- Active staff member (no MFA requirement). Used for read-only "am I staff" checks.
create or replace function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = (select auth.uid()) and sm.status = 'active'
  );
$$;

-- The central authorization primitive. Reads the CURRENT role assignment on every
-- call (never a cached claim), and requires an aal2 session for every staff
-- permission. Customers have no permissions.
create or replace function private.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_mfa_verified() and exists (
    select 1
    from public.staff_members sm
    join public.role_permissions rp on rp.role_code = sm.role_code
    where sm.user_id = (select auth.uid())
      and sm.status = 'active'
      and rp.permission_code = p_permission
  );
$$;

-- Active super admin with an aal2 session.
create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_mfa_verified() and exists (
    select 1 from public.staff_members sm
    where sm.user_id = (select auth.uid()) and sm.status = 'active' and sm.role_code = 'super_admin'
  );
$$;

revoke all on function private.is_mfa_verified() from public;
revoke all on function private.is_super_admin() from public;
grant execute on function private.is_super_admin() to authenticated, service_role;
revoke all on function private.is_active_staff() from public;
revoke all on function private.has_permission(text) from public;
grant execute on function private.is_mfa_verified() to authenticated, service_role;
grant execute on function private.is_active_staff() to authenticated, service_role;
grant execute on function private.has_permission(text) to authenticated, service_role;

-- What the admin UI uses to render menus. UI gating is cosmetic; every write is
-- re-checked by RLS / RPCs with private.has_permission().
create or replace function public.my_staff_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'aal', coalesce((select auth.jwt() ->> 'aal'), 'aal1'),
    'is_staff', sm.user_id is not null and sm.status = 'active',
    'status', sm.status,
    'role', sm.role_code,
    'display_name', sm.display_name,
    'permissions', coalesce(
      (select jsonb_agg(rp.permission_code order by rp.permission_code)
         from public.role_permissions rp where rp.role_code = sm.role_code),
      '[]'::jsonb)
  )
  from (select 1) one
  left join public.staff_members sm on sm.user_id = (select auth.uid());
$$;
revoke all on function public.my_staff_context() from public;
grant execute on function public.my_staff_context() to authenticated;

alter table public.permissions enable row level security;
alter table public.staff_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_members enable row level security;

grant select on public.permissions, public.staff_roles, public.role_permissions to authenticated;
grant select on public.staff_members to authenticated;
grant insert, update on public.staff_members to authenticated;

create policy "staff read permission catalog" on public.permissions
  for select to authenticated using ((select private.is_active_staff()));
create policy "staff read roles" on public.staff_roles
  for select to authenticated using ((select private.is_active_staff()));
create policy "staff read role permissions" on public.role_permissions
  for select to authenticated using ((select private.is_active_staff()));

create policy "staff read own membership" on public.staff_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "staff managers read members" on public.staff_members
  for select to authenticated using ((select private.has_permission('staff.manage')));
create policy "staff managers add members" on public.staff_members
  for insert to authenticated with check ((select private.has_permission('staff.manage')) and role_code <> 'super_admin');
-- Nobody edits their own membership; super_admin assignments are done by a super_admin.
create policy "staff managers change members" on public.staff_members
  for update to authenticated
  using ((select private.has_permission('staff.manage')) and user_id <> (select auth.uid()))
  with check (
    (select private.has_permission('staff.manage'))
    and user_id <> (select auth.uid())
    and (role_code <> 'super_admin' or (select private.is_super_admin()))
  );

-- -----------------------------------------------------------------------------
-- Customer identity
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  phone text check (phone is null or phone ~ '^\+8801[3-9][0-9]{8}$'),
  marketing_opt_in boolean not null default false,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
-- Column-level: customers may only change these columns (not is_disabled).
grant update (full_name, phone, marketing_opt_in) on public.profiles to authenticated;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "staff read customer profiles" on public.profiles
  for select to authenticated using ((select private.has_permission('customers.read')));
create policy "update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home' check (char_length(label) <= 40),
  recipient_name text not null check (char_length(recipient_name) between 2 and 120),
  phone text not null check (phone ~ '^\+8801[3-9][0-9]{8}$'),
  division text not null check (char_length(division) between 2 and 60),
  district text not null check (char_length(district) between 2 and 60),
  area text not null check (char_length(area) between 2 and 80),
  address_line text not null check (char_length(address_line) between 5 and 300),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{4}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses(user_id);
create trigger addresses_updated_at before update on public.addresses
  for each row execute function private.set_updated_at();

alter table public.addresses enable row level security;
grant select, insert, update, delete on public.addresses to authenticated;
create policy "own addresses select" on public.addresses
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own addresses insert" on public.addresses
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own addresses update" on public.addresses
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own addresses delete" on public.addresses
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "staff read addresses" on public.addresses
  for select to authenticated using ((select private.has_permission('customers.read')));

-- -----------------------------------------------------------------------------
-- Audit log (append-only). Written only by SECURITY DEFINER code paths/triggers.
-- -----------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  action text not null check (char_length(action) <= 80),
  entity_type text not null check (char_length(entity_type) <= 60),
  entity_id text,
  reason text check (reason is null or char_length(reason) <= 500),
  before_data jsonb,
  after_data jsonb
);
create index audit_events_entity_idx on public.audit_events(entity_type, entity_id);
create index audit_events_occurred_idx on public.audit_events(occurred_at desc);
create index audit_events_actor_idx on public.audit_events(actor_id);
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function private.forbid_mutation();

alter table public.audit_events enable row level security;
grant select on public.audit_events to authenticated;
create policy "auditors read audit log" on public.audit_events
  for select to authenticated using ((select private.has_permission('audit.read')));

create or replace function private.write_audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, before_data, after_data, reason)
  values (
    (select auth.uid()),
    (select sm.role_code from public.staff_members sm where sm.user_id = (select auth.uid())),
    p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason);
$$;
revoke all on function private.write_audit(text, text, text, jsonb, jsonb, text) from public;

-- Generic row-change audit trigger for staff-managed tables.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if tg_op = 'DELETE' then
    v_id := (to_jsonb(old) ->> 'id');
    perform private.write_audit(lower(tg_op), tg_table_name, v_id, to_jsonb(old), null, null);
    return old;
  end if;
  v_id := coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'user_id', to_jsonb(new) ->> 'variant_id');
  perform private.write_audit(lower(tg_op), tg_table_name, v_id,
    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), null);
  return new;
end;
$$;
revoke all on function private.audit_row_change() from public;

create trigger staff_members_audit after insert or update or delete on public.staff_members
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- Seed the RBAC catalogue (reference data, not demo data)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, description) values
  ('analytics.read', 'View sales analytics and dashboards'),
  ('analytics.export', 'Export analytics/CSV reports'),
  ('products.read', 'View all products including drafts'),
  ('products.write', 'Create and edit products, variants, media'),
  ('products.costs', 'View and edit cost prices'),
  ('inventory.read', 'View stock levels and ledger'),
  ('inventory.adjust', 'Adjust stock with a reason'),
  ('inventory.approve_large', 'Approve stock adjustments above the large threshold'),
  ('orders.read', 'View orders'),
  ('orders.fulfill', 'Confirm, pick, pack and ship orders'),
  ('orders.refund', 'Initiate refunds'),
  ('orders.cancel', 'Cancel orders under policy'),
  ('risk.review', 'Review risky orders'),
  ('customers.read', 'View customer profiles and addresses'),
  ('customers.manage', 'Disable/reactivate customers, privacy requests'),
  ('cms.edit', 'Edit CMS pages and hero scenes (drafts)'),
  ('cms.publish', 'Publish CMS pages and hero scenes'),
  ('theme.publish', 'Publish storefront theme versions'),
  ('marketing.manage', 'Manage coupons, campaigns, templates'),
  ('marketing.read', 'View marketing campaigns'),
  ('automation.manage', 'Manage automation rules'),
  ('integrations.manage', 'Manage integration connections (secret references only)'),
  ('integrations.read', 'View integration health metadata'),
  ('settings.manage', 'Manage store settings'),
  ('settings.security', 'Manage security settings'),
  ('staff.manage', 'Invite staff and change roles'),
  ('audit.read', 'Read the audit log'),
  ('tryon.manage', 'Configure AI try-on and view operational metrics');

insert into public.staff_roles (code, name, description, rank) values
  ('super_admin', 'Super admin', 'Full control including staff roles and security settings', 100),
  ('admin', 'Admin', 'Runs the store; restricted on secrets and super-admin assignment', 90),
  ('catalog_manager', 'Catalog manager', 'Products, variants, media', 50),
  ('inventory_manager', 'Inventory manager', 'Stock levels and movements', 50),
  ('order_manager', 'Order manager', 'Orders, fulfilment, risk review', 50),
  ('support_agent', 'Support agent', 'Read orders/customers, limited fulfilment help', 30),
  ('marketing_manager', 'Marketing manager', 'Coupons, campaigns, automations', 40),
  ('content_editor', 'Content editor', 'CMS pages and hero scenes', 30),
  ('analyst', 'Analyst', 'Read-only analytics', 20);

-- Explicit mapping of the spec's permission matrix (section 13). "limited" cases are
-- expressed as read-only permissions; see docs/ADMIN_RBAC_MATRIX.md.
insert into public.role_permissions (role_code, permission_code)
select 'super_admin', code from public.permissions;

insert into public.role_permissions (role_code, permission_code)
select 'admin', code from public.permissions
where code not in ('settings.security', 'integrations.manage');
-- admin: staff.manage is allowed but cannot assign super_admin (enforced in policy above).

insert into public.role_permissions (role_code, permission_code) values
  ('catalog_manager', 'products.read'), ('catalog_manager', 'products.write'),
  ('catalog_manager', 'products.costs'), ('catalog_manager', 'inventory.read'),
  ('catalog_manager', 'analytics.read'),
  ('inventory_manager', 'products.read'), ('inventory_manager', 'inventory.read'),
  ('inventory_manager', 'inventory.adjust'), ('inventory_manager', 'products.costs'),
  ('inventory_manager', 'analytics.read'),
  ('order_manager', 'orders.read'), ('order_manager', 'orders.fulfill'),
  ('order_manager', 'orders.cancel'), ('order_manager', 'risk.review'),
  ('order_manager', 'customers.read'), ('order_manager', 'analytics.read'),
  ('order_manager', 'products.read'), ('order_manager', 'inventory.read'),
  ('support_agent', 'orders.read'), ('support_agent', 'customers.read'),
  ('support_agent', 'products.read'),
  ('marketing_manager', 'marketing.manage'), ('marketing_manager', 'marketing.read'),
  ('marketing_manager', 'automation.manage'), ('marketing_manager', 'analytics.read'),
  ('marketing_manager', 'integrations.read'), ('marketing_manager', 'products.read'),
  ('content_editor', 'cms.edit'), ('content_editor', 'cms.publish'), ('content_editor', 'products.read'),
  ('analyst', 'analytics.read'), ('analyst', 'analytics.export'), ('analyst', 'marketing.read');
