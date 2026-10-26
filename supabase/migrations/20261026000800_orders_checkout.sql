-- =============================================================================
-- Fabriklo 0008: checkout + orders (COD), shipping zones, customer-safe tracking,
-- order state machine, explainable risk signals, manual shipments, expiry job.
-- Clients never write orders directly: everything goes through these RPCs.
-- =============================================================================

alter table public.stock_movements drop constraint stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check check (movement_type in (
  'receive', 'adjust', 'reserve', 'release', 'expire', 'commit', 'return', 'damage', 'transfer_in', 'transfer_out', 'restock'));

-- -----------------------------------------------------------------------------
-- Bangladesh geography (reference data: 8 divisions, 64 districts)
-- -----------------------------------------------------------------------------
create table public.bd_districts (
  district text primary key,
  division text not null
);
insert into public.bd_districts (division, district) values
  ('Barishal','Barguna'),('Barishal','Barishal'),('Barishal','Bhola'),('Barishal','Jhalokati'),('Barishal','Patuakhali'),('Barishal','Pirojpur'),
  ('Chattogram','Bandarban'),('Chattogram','Brahmanbaria'),('Chattogram','Chandpur'),('Chattogram','Chattogram'),('Chattogram','Cox''s Bazar'),
  ('Chattogram','Cumilla'),('Chattogram','Feni'),('Chattogram','Khagrachhari'),('Chattogram','Lakshmipur'),('Chattogram','Noakhali'),('Chattogram','Rangamati'),
  ('Dhaka','Dhaka'),('Dhaka','Faridpur'),('Dhaka','Gazipur'),('Dhaka','Gopalganj'),('Dhaka','Kishoreganj'),('Dhaka','Madaripur'),('Dhaka','Manikganj'),
  ('Dhaka','Munshiganj'),('Dhaka','Narayanganj'),('Dhaka','Narsingdi'),('Dhaka','Rajbari'),('Dhaka','Shariatpur'),('Dhaka','Tangail'),
  ('Khulna','Bagerhat'),('Khulna','Chuadanga'),('Khulna','Jashore'),('Khulna','Jhenaidah'),('Khulna','Khulna'),('Khulna','Kushtia'),('Khulna','Magura'),
  ('Khulna','Meherpur'),('Khulna','Narail'),('Khulna','Satkhira'),
  ('Mymensingh','Jamalpur'),('Mymensingh','Mymensingh'),('Mymensingh','Netrokona'),('Mymensingh','Sherpur'),
  ('Rajshahi','Bogura'),('Rajshahi','Chapainawabganj'),('Rajshahi','Joypurhat'),('Rajshahi','Naogaon'),('Rajshahi','Natore'),('Rajshahi','Pabna'),
  ('Rajshahi','Rajshahi'),('Rajshahi','Sirajganj'),
  ('Rangpur','Dinajpur'),('Rangpur','Gaibandha'),('Rangpur','Kurigram'),('Rangpur','Lalmonirhat'),('Rangpur','Nilphamari'),('Rangpur','Panchagarh'),
  ('Rangpur','Rangpur'),('Rangpur','Thakurgaon'),
  ('Sylhet','Habiganj'),('Sylhet','Moulvibazar'),('Sylhet','Sunamganj'),('Sylhet','Sylhet');

alter table public.bd_districts enable row level security;
grant select on public.bd_districts to anon, authenticated;
create policy "public read districts" on public.bd_districts for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- Shipping zones (rates are configuration, never hard-coded in app code)
-- -----------------------------------------------------------------------------
create table public.shipping_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,40}$'),
  name text not null check (char_length(name) between 2 and 80),
  districts text[] not null default '{}',
  is_fallback boolean not null default false,
  fee_minor integer not null check (fee_minor between 0 and 10000000),
  free_over_minor integer check (free_over_minor is null or free_over_minor > 0),
  cod_enabled boolean not null default true,
  estimate_min_days int not null default 1 check (estimate_min_days between 0 and 60),
  estimate_max_days int not null default 3 check (estimate_max_days between 0 and 60),
  is_active boolean not null default true,
  position int not null default 0,
  updated_at timestamptz not null default now(),
  check (estimate_max_days >= estimate_min_days)
);
create unique index shipping_zones_single_fallback on public.shipping_zones(is_fallback) where is_fallback and is_active;
create trigger shipping_zones_updated_at before update on public.shipping_zones
  for each row execute function private.set_updated_at();
create trigger shipping_zones_audit after insert or update on public.shipping_zones
  for each row execute function private.audit_row_change();

alter table public.shipping_zones enable row level security;
grant select on public.shipping_zones to anon, authenticated;
grant insert, update on public.shipping_zones to authenticated;
create policy "public read active zones" on public.shipping_zones for select to anon, authenticated using (is_active);
create policy "settings read zones" on public.shipping_zones for select to authenticated using ((select private.has_permission('settings.manage')));
create policy "settings write zones" on public.shipping_zones for insert to authenticated with check ((select private.has_permission('settings.manage')));
create policy "settings update zones" on public.shipping_zones for update to authenticated
  using ((select private.has_permission('settings.manage'))) with check ((select private.has_permission('settings.manage')));

create or replace function private.zone_for_district(p_district text)
returns public.shipping_zones
language sql
stable
security definer
set search_path = ''
as $$
  select z.* from public.shipping_zones z
  where z.is_active and (p_district = any(z.districts) or z.is_fallback)
  order by (p_district = any(z.districts)) desc, z.position
  limit 1;
$$;
revoke all on function private.zone_for_district(text) from public;

-- -----------------------------------------------------------------------------
-- Keys for customer tracking tokens (HMAC). Never exposed; private schema only.
-- -----------------------------------------------------------------------------
create table private.app_keys (
  id boolean primary key default true check (id),
  tracking_hmac_key bytea not null default extensions.gen_random_bytes(32)
);
insert into private.app_keys default values;

create or replace function private.tracking_token(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(translate(encode(extensions.hmac(convert_to(p_order_id::text, 'UTF8'), k.tracking_hmac_key, 'sha256'::text), 'base64'), '+/=', '-_'), 32)
  from private.app_keys k;
$$;
revoke all on function private.tracking_token(uuid) from public;

-- -----------------------------------------------------------------------------
-- Shipments (manual courier tracking now; courier adapters later)
-- -----------------------------------------------------------------------------
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  courier text not null check (courier in ('manual', 'pathao', 'steadfast', 'redx', 'other')),
  courier_name text check (courier_name is null or char_length(courier_name) <= 60),
  tracking_number text check (tracking_number is null or tracking_number ~ '^[A-Za-z0-9-]{3,60}$'),
  tracking_url text check (tracking_url is null or (tracking_url ~ '^https://[A-Za-z0-9.-]+(/[^\s<>"]*)?$' and char_length(tracking_url) <= 300)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger shipments_updated_at before update on public.shipments
  for each row execute function private.set_updated_at();
alter table public.shipments enable row level security;
grant select on public.shipments to authenticated;
create policy "staff read shipments" on public.shipments for select to authenticated using ((select private.has_permission('orders.read')));
create policy "customers read own shipments" on public.shipments for select to authenticated using (exists (
  select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- Risk signals: explainable, neutral, review-driven. Never an automatic ban.
-- -----------------------------------------------------------------------------
create table public.risk_signals (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  rule_code text not null check (rule_code in ('phone_velocity', 'duplicate_order', 'high_value_new_phone', 'prior_returns', 'manual_flag')),
  level text not null check (level in ('low', 'medium', 'high')),
  explanation text not null check (char_length(explanation) <= 300),
  created_at timestamptz not null default now()
);
create index risk_signals_order_idx on public.risk_signals(order_id);
alter table public.risk_signals enable row level security;
grant select on public.risk_signals to authenticated;
create policy "risk reviewers read signals" on public.risk_signals for select to authenticated using ((select private.has_permission('risk.review')));

create table private.risk_settings (
  id boolean primary key default true check (id),
  phone_orders_24h_threshold int not null default 3,
  duplicate_window_minutes int not null default 15,
  high_value_minor int not null default 1500000,
  prior_returns_threshold int not null default 2,
  signal_retention_days int not null default 180
);
insert into private.risk_settings default values;

create or replace function private.evaluate_order_risk(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  s private.risk_settings;
  v_count int;
  v_level text := 'low';
  v_rank int := 0;
begin
  select * into o from public.orders where id = p_order_id;
  select * into s from private.risk_settings;

  select count(*) into v_count from public.orders
   where customer_phone = o.customer_phone and id <> o.id and placed_at > now() - interval '24 hours';
  if v_count + 1 >= s.phone_orders_24h_threshold then
    insert into public.risk_signals (order_id, rule_code, level, explanation)
    values (o.id, 'phone_velocity', 'medium', format('%s orders from this phone number in 24 hours', v_count + 1));
    v_rank := greatest(v_rank, 2);
  end if;

  select count(*) into v_count from public.orders x
   where x.customer_phone = o.customer_phone and x.id <> o.id
     and x.placed_at > now() - make_interval(mins => s.duplicate_window_minutes)
     and x.total_minor = o.total_minor;
  if v_count > 0 then
    insert into public.risk_signals (order_id, rule_code, level, explanation)
    values (o.id, 'duplicate_order', 'medium', format('Same phone and total as an order placed within %s minutes', s.duplicate_window_minutes));
    v_rank := greatest(v_rank, 2);
  end if;

  if o.payment_method = 'cod' and o.total_minor >= s.high_value_minor and not exists (
      select 1 from public.orders x where x.customer_phone = o.customer_phone and x.id <> o.id and x.shipment_status = 'delivered') then
    insert into public.risk_signals (order_id, rule_code, level, explanation)
    values (o.id, 'high_value_new_phone', 'medium', 'High-value cash-on-delivery order from a number with no delivered orders yet');
    v_rank := greatest(v_rank, 2);
  end if;

  select count(*) into v_count from public.orders x
   where x.customer_phone = o.customer_phone and x.id <> o.id and x.shipment_status in ('rto', 'returned');
  if v_count >= s.prior_returns_threshold then
    insert into public.risk_signals (order_id, rule_code, level, explanation)
    values (o.id, 'prior_returns', 'high', format('%s earlier orders to this number were returned to sender', v_count));
    v_rank := greatest(v_rank, 3);
  end if;

  v_level := case v_rank when 3 then 'high' when 2 then 'medium' else 'low' end;
  return v_level;
end;
$$;
revoke all on function private.evaluate_order_risk(uuid) from public;

-- -----------------------------------------------------------------------------
-- Quote: server-side pricing of a cart for a district
-- -----------------------------------------------------------------------------
create or replace function private.quote_cart(p_cart_id uuid, p_district text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_subtotal bigint;
  v_zone public.shipping_zones;
  v_fee bigint;
  v_issues jsonb;
  v_cod jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', v.id, 'title', p.title, 'sku', v.sku, 'size', v.size, 'color', v.color,
           'quantity', ci.quantity, 'unit_price_minor', v.price_minor,
           'line_total_minor', v.price_minor * ci.quantity,
           'available', coalesce(av.available, 0),
           'purchasable', v.is_active and private.product_is_public(p.id)) order by ci.added_at), '[]'::jsonb)
    into v_lines
  from public.cart_items ci
  join public.product_variants v on v.id = ci.variant_id
  join public.products p on p.id = v.product_id
  left join lateral public.get_variant_availability(array[v.id]) av on true
  where ci.cart_id = p_cart_id;

  select coalesce(sum((l ->> 'line_total_minor')::bigint), 0) into v_subtotal from jsonb_array_elements(v_lines) l;
  select coalesce(jsonb_agg(jsonb_build_object('sku', l ->> 'sku', 'title', l ->> 'title',
            'problem', case when not (l ->> 'purchasable')::boolean then 'unavailable' else 'insufficient_stock' end,
            'available', (l ->> 'available')::int)), '[]'::jsonb)
    into v_issues
  from jsonb_array_elements(v_lines) l
  where not (l ->> 'purchasable')::boolean or (l ->> 'available')::int < (l ->> 'quantity')::int;

  if p_district is not null then
    v_zone := private.zone_for_district(p_district);
  end if;
  v_fee := case when v_zone.id is null then null
                when v_zone.free_over_minor is not null and v_subtotal >= v_zone.free_over_minor then 0
                else v_zone.fee_minor end;
  select value into v_cod from public.site_settings where key = 'checkout.cod';

  return jsonb_build_object(
    'currency', 'BDT',
    'lines', v_lines,
    'issues', v_issues,
    'subtotal_minor', v_subtotal,
    'discount_minor', 0,
    'tax_minor', 0,
    'shipping_minor', v_fee,
    'total_minor', case when v_fee is null then null else v_subtotal + v_fee end,
    'zone', case when v_zone.id is null then null else jsonb_build_object(
        'code', v_zone.code, 'name', v_zone.name, 'min_days', v_zone.estimate_min_days, 'max_days', v_zone.estimate_max_days) end,
    'district_known', p_district is null or exists (select 1 from public.bd_districts d where d.district = p_district),
    'cod_available', v_zone.id is not null and v_zone.cod_enabled
        and coalesce((v_cod ->> 'enabled')::boolean, false)
        and (v_subtotal + coalesce(v_fee, 0)) <= coalesce((v_cod ->> 'max_order_minor')::bigint, 0),
    'cod_max_order_minor', (v_cod ->> 'max_order_minor')::bigint
  );
end;
$$;
revoke all on function private.quote_cart(uuid, text) from public;

create or replace function public.checkout_quote(p_cart_token text, p_district text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
begin
  v_cart := private.cart_by_token(p_cart_token);
  if v_cart.id is null then
    return null;
  end if;
  return private.quote_cart(v_cart.id, p_district);
end;
$$;
revoke all on function public.checkout_quote(text, text) from public;
grant execute on function public.checkout_quote(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Create order (COD). Idempotent; reserves + commits stock atomically.
-- -----------------------------------------------------------------------------
create or replace function public.create_order(
  p_cart_token text,
  p_idempotency_key text,
  p_customer jsonb,
  p_address jsonb,
  p_payment_method text,
  p_expected_total_minor bigint,
  p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing public.orders;
  v_cart public.carts;
  v_quote jsonb;
  v_order public.orders;
  v_name text := btrim(coalesce(p_customer ->> 'name', ''));
  v_phone text := btrim(coalesce(p_customer ->> 'phone', ''));
  v_email text := nullif(lower(btrim(coalesce(p_customer ->> 'email', ''))), '');
  v_district text := btrim(coalesce(p_address ->> 'district', ''));
  v_division text;
  v_area text := btrim(coalesce(p_address ->> 'area', ''));
  v_line text := btrim(coalesce(p_address ->> 'address_line', ''));
  v_postal text := nullif(btrim(coalesce(p_address ->> 'postal_code', '')), '');
  v_item record;
  v_res public.inventory_reservations;
  v_risk text;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$' then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  -- Replay: same key returns the same order (and the same tracking token).
  select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number,
      'tracking_token', private.tracking_token(v_existing.id), 'total_minor', v_existing.total_minor, 'replayed', true);
  end if;

  if p_payment_method <> 'cod' then
    raise exception 'payment method not available' using errcode = '22023', hint = 'payment_unavailable';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'name is required' using errcode = '22023', hint = 'invalid_name';
  end if;
  if v_phone !~ '^\+8801[3-9][0-9]{8}$' then
    raise exception 'a valid Bangladesh mobile number is required' using errcode = '22023', hint = 'invalid_phone';
  end if;
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254) then
    raise exception 'invalid email' using errcode = '22023', hint = 'invalid_email';
  end if;
  select division into v_division from public.bd_districts where district = v_district;
  if v_division is null then
    raise exception 'unknown district' using errcode = '22023', hint = 'invalid_district';
  end if;
  if char_length(v_area) not between 2 and 80 or char_length(v_line) not between 5 and 300 then
    raise exception 'address is incomplete' using errcode = '22023', hint = 'invalid_address';
  end if;
  if v_postal is not null and v_postal !~ '^[0-9]{4}$' then
    raise exception 'invalid postal code' using errcode = '22023', hint = 'invalid_postal_code';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'note too long' using errcode = '22023';
  end if;

  v_cart := private.cart_by_token(p_cart_token);
  if v_cart.id is null then
    raise exception 'cart not found' using errcode = 'P0002', hint = 'cart_missing';
  end if;
  -- Serialise checkouts of the same cart.
  perform 1 from public.carts where id = v_cart.id for update;
  if (select status from public.carts where id = v_cart.id) <> 'active' then
    raise exception 'cart already checked out' using errcode = 'P0002', hint = 'cart_missing';
  end if;

  v_quote := private.quote_cart(v_cart.id, v_district);
  if jsonb_array_length(v_quote -> 'lines') = 0 then
    raise exception 'cart is empty' using errcode = '22023', hint = 'cart_empty';
  end if;
  if jsonb_array_length(v_quote -> 'issues') > 0 then
    raise exception 'some items are no longer available' using errcode = 'P0001', hint = 'stock_unavailable';
  end if;
  if (v_quote ->> 'total_minor') is null then
    raise exception 'delivery is not available to this district' using errcode = 'P0001', hint = 'no_delivery';
  end if;
  if (v_quote ->> 'total_minor')::bigint <> p_expected_total_minor then
    raise exception 'prices or delivery fee changed; please review the new total' using errcode = 'P0001', hint = 'quote_changed';
  end if;
  if not (v_quote ->> 'cod_available')::boolean then
    raise exception 'cash on delivery is not available for this order' using errcode = 'P0001', hint = 'cod_unavailable';
  end if;

  insert into public.orders (user_id, cart_id, idempotency_key, customer_name, customer_phone, customer_email,
      shipping_address, subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor,
      payment_method, payment_status, customer_note, is_demo)
  values ((select auth.uid()), v_cart.id, p_idempotency_key, v_name, v_phone, v_email,
      jsonb_build_object('recipient_name', v_name, 'phone', v_phone, 'division', v_division, 'district', v_district,
                         'area', v_area, 'address_line', v_line, 'postal_code', v_postal,
                         'zone', v_quote -> 'zone'),
      (v_quote ->> 'subtotal_minor')::bigint, 0, (v_quote ->> 'shipping_minor')::bigint, 0,
      (v_quote ->> 'total_minor')::bigint, 'cod', 'cod_pending', nullif(btrim(coalesce(p_note, '')), ''),
      exists (select 1 from public.cart_items ci join public.product_variants v on v.id = ci.variant_id
              join public.products p on p.id = v.product_id where ci.cart_id = v_cart.id and p.is_demo))
  returning * into v_order;

  for v_item in
    select ci.variant_id, ci.quantity, v.sku, v.size, v.color, v.price_minor, p.title
    from public.cart_items ci
    join public.product_variants v on v.id = ci.variant_id
    join public.products p on p.id = v.product_id
    where ci.cart_id = v_cart.id
    order by v.id -- consistent lock order prevents deadlocks between checkouts
  loop
    v_res := private.reserve_stock(v_item.variant_id, v_item.quantity, v_order.id,
      'order:' || v_order.id::text || ':' || v_item.variant_id::text);
    -- COD: the order owns the units from now; cancellation restocks.
    perform private.close_reservation(v_res.id, 'committed');
    insert into public.order_items (order_id, variant_id, product_title, sku, size, color, unit_price_minor, quantity,
        line_total_minor, reservation_id)
    values (v_order.id, v_item.variant_id, v_item.title, v_item.sku, v_item.size, v_item.color, v_item.price_minor,
        v_item.quantity, v_item.price_minor * v_item.quantity, v_res.id);
  end loop;

  update public.carts set status = 'converted' where id = v_cart.id;

  v_risk := private.evaluate_order_risk(v_order.id);
  update public.orders
     set tracking_token_hash = extensions.digest(private.tracking_token(v_order.id), 'sha256'),
         risk_level = v_risk,
         risk_review_status = case when v_risk in ('medium', 'high') then 'needs_review' else 'not_required' end
   where id = v_order.id;

  insert into public.order_status_events (order_id, field, from_value, to_value, actor_id, actor_kind, customer_visible, reason)
  values (v_order.id, 'created', null, 'placed', (select auth.uid()), 'customer', true, 'Order placed (cash on delivery)');
  if v_risk in ('medium', 'high') then
    insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible, reason)
    values (v_order.id, 'risk_review_status', 'not_required', 'needs_review', 'system', false, 'Automatic rules flagged this order for a quick check');
  end if;

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
    'tracking_token', private.tracking_token(v_order.id), 'total_minor', v_order.total_minor, 'replayed', false);
end;
$$;
revoke all on function public.create_order(text, text, jsonb, jsonb, text, bigint, text) from public;
grant execute on function public.create_order(text, text, jsonb, jsonb, text, bigint, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Customer-safe tracking: requires order number AND the unguessable token.
-- -----------------------------------------------------------------------------
create or replace function public.track_order(p_order_number text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_ship public.shipments;
begin
  if p_order_number is null or p_order_number !~ '^FBK-[0-9]{6,10}$' or p_token is null or p_token !~ '^[A-Za-z0-9_-]{32}$' then
    return null;
  end if;
  select * into o from public.orders
   where order_number = p_order_number and tracking_token_hash = extensions.digest(p_token, 'sha256');
  if not found then
    return null;
  end if;
  select * into v_ship from public.shipments where order_id = o.id;

  return jsonb_build_object(
    'order_number', o.order_number,
    'placed_at', o.placed_at,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'fulfillment_status', o.fulfillment_status,
    'shipment_status', o.shipment_status,
    'currency', o.currency,
    'subtotal_minor', o.subtotal_minor,
    'shipping_minor', o.shipping_minor,
    'discount_minor', o.discount_minor,
    'total_minor', o.total_minor,
    'is_demo', o.is_demo,
    -- Minimised personal data: first name, masked phone, district only.
    'recipient', split_part(o.customer_name, ' ', 1),
    'phone_masked', left(o.customer_phone, 6) || '*****' || right(o.customer_phone, 3),
    'district', o.shipping_address ->> 'district',
    'estimate', o.shipping_address -> 'zone',
    'items', (select coalesce(jsonb_agg(jsonb_build_object('title', i.product_title, 'size', i.size, 'color', i.color,
                 'quantity', i.quantity, 'line_total_minor', i.line_total_minor) order by i.created_at), '[]'::jsonb)
              from public.order_items i where i.order_id = o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.occurred_at, 'field', e.field, 'status', e.to_value)
                 order by e.occurred_at), '[]'::jsonb)
               from public.order_status_events e where e.order_id = o.id and e.customer_visible),
    'shipment', case when v_ship.id is null then null else jsonb_build_object(
        'courier', coalesce(v_ship.courier_name, v_ship.courier), 'tracking_number', v_ship.tracking_number,
        'tracking_url', v_ship.tracking_url) end
  );
end;
$$;
revoke all on function public.track_order(text, text) from public;
grant execute on function public.track_order(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- State machine
-- -----------------------------------------------------------------------------
create or replace function private.order_transition_allowed(p_field text, p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_field, p_from, p_to) in (
    ('fulfillment_status', 'unfulfilled', 'confirmed'),
    ('fulfillment_status', 'confirmed', 'picking'),
    ('fulfillment_status', 'picking', 'packed'),
    ('fulfillment_status', 'unfulfilled', 'cancelled'),
    ('fulfillment_status', 'confirmed', 'cancelled'),
    ('fulfillment_status', 'picking', 'cancelled'),
    ('fulfillment_status', 'packed', 'cancelled'),
    ('shipment_status', 'not_shipped', 'ready_for_pickup'),
    ('shipment_status', 'ready_for_pickup', 'handed_to_courier'),
    ('shipment_status', 'handed_to_courier', 'in_transit'),
    ('shipment_status', 'in_transit', 'out_for_delivery'),
    ('shipment_status', 'out_for_delivery', 'delivered'),
    ('shipment_status', 'out_for_delivery', 'delivery_failed'),
    ('shipment_status', 'delivery_failed', 'out_for_delivery'),
    ('shipment_status', 'delivery_failed', 'rto'),
    ('shipment_status', 'rto', 'returned'),
    ('payment_status', 'cod_pending', 'cod_collected'),
    ('risk_review_status', 'not_required', 'needs_review'),
    ('risk_review_status', 'needs_review', 'verified'),
    ('risk_review_status', 'needs_review', 'approved'),
    ('risk_review_status', 'verified', 'approved'),
    ('risk_review_status', 'needs_review', 'rejected_with_reason'),
    ('risk_review_status', 'verified', 'rejected_with_reason'),
    ('risk_review_status', 'needs_review', 'blocked_by_policy')
  );
$$;
grant execute on function private.order_transition_allowed(text, text, text) to authenticated, service_role;

create or replace function private.restock_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i record;
  v_wh uuid;
begin
  for i in select oi.id, oi.variant_id, oi.quantity, r.warehouse_id
           from public.order_items oi left join public.inventory_reservations r on r.id = oi.reservation_id
           where oi.order_id = p_order_id and oi.variant_id is not null
           order by oi.variant_id
  loop
    v_wh := coalesce(i.warehouse_id, (select id from public.warehouses where is_default));
    perform private.apply_stock_movement(i.variant_id, v_wh, 'restock', i.quantity, 0, p_reason,
      'order', p_order_id::text, 'restock:' || i.id::text);
  end loop;
end;
$$;
revoke all on function private.restock_order(uuid, text) from public;

create or replace function public.admin_order_transition(
  p_order_id uuid, p_field text, p_to text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_from text;
  v_perm text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_visible boolean;
begin
  if p_field not in ('fulfillment_status', 'shipment_status', 'payment_status', 'risk_review_status') then
    raise exception 'invalid field' using errcode = '22023';
  end if;
  v_perm := case
    when p_field = 'risk_review_status' then 'risk.review'
    when p_field = 'fulfillment_status' and p_to = 'cancelled' then 'orders.cancel'
    else 'orders.fulfill' end;
  if not private.has_permission(v_perm) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason too long' using errcode = '22023';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  v_from := to_jsonb(o) ->> p_field;
  if v_from = p_to then
    return jsonb_build_object('order_id', o.id, 'field', p_field, 'status', p_to, 'changed', false);
  end if;
  if not private.order_transition_allowed(p_field, v_from, p_to) then
    raise exception 'cannot change % from % to %', p_field, v_from, p_to using errcode = '22023', hint = 'invalid_transition';
  end if;

  -- Guards across the separate state dimensions
  if p_field in ('fulfillment_status', 'shipment_status') and p_to not in ('cancelled')
     and o.risk_review_status in ('needs_review', 'rejected_with_reason', 'blocked_by_policy') then
    raise exception 'order is waiting for risk review' using errcode = 'P0001', hint = 'risk_review_pending';
  end if;
  if o.fulfillment_status = 'cancelled' and p_field <> 'risk_review_status' then
    raise exception 'order is cancelled' using errcode = 'P0001', hint = 'order_cancelled';
  end if;
  if p_field = 'fulfillment_status' and p_to = 'cancelled' then
    if o.shipment_status not in ('not_shipped', 'ready_for_pickup') then
      raise exception 'order has already left the store' using errcode = 'P0001', hint = 'already_shipped';
    end if;
    if v_reason is null then
      raise exception 'a reason is required to cancel' using errcode = '22023', hint = 'reason_required';
    end if;
  end if;
  if p_field = 'shipment_status' and p_to = 'ready_for_pickup' and o.fulfillment_status <> 'packed' then
    raise exception 'pack the order first' using errcode = 'P0001', hint = 'not_packed';
  end if;
  if p_field = 'payment_status' and p_to = 'cod_collected' and o.shipment_status <> 'delivered' then
    raise exception 'cash can only be recorded after delivery' using errcode = 'P0001', hint = 'not_delivered';
  end if;
  if p_field = 'risk_review_status' and p_to in ('rejected_with_reason', 'blocked_by_policy') and v_reason is null then
    raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required';
  end if;
  if p_field = 'shipment_status' and p_to = 'delivery_failed' and v_reason is null then
    raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required';
  end if;

  execute format('update public.orders set %I = $1 where id = $2', p_field) using p_to, o.id;
  v_visible := p_field in ('fulfillment_status', 'shipment_status') or (p_field = 'payment_status');
  insert into public.order_status_events (order_id, field, from_value, to_value, actor_id, actor_kind, reason, customer_visible)
  values (o.id, p_field, v_from, p_to, (select auth.uid()), 'staff', v_reason, v_visible);

  -- Side effects
  if p_field = 'shipment_status' and p_to = 'handed_to_courier' then
    update public.orders set fulfillment_status = 'fulfilled' where id = o.id;
    insert into public.order_status_events (order_id, field, from_value, to_value, actor_id, actor_kind, customer_visible)
    values (o.id, 'fulfillment_status', o.fulfillment_status, 'fulfilled', (select auth.uid()), 'system', true);
  end if;

  if (p_field = 'fulfillment_status' and p_to = 'cancelled')
     or (p_field = 'risk_review_status' and p_to in ('rejected_with_reason', 'blocked_by_policy')
         and o.fulfillment_status <> 'cancelled') then
    if p_field = 'risk_review_status' then
      if o.shipment_status not in ('not_shipped', 'ready_for_pickup') then
        raise exception 'order has already left the store' using errcode = 'P0001', hint = 'already_shipped';
      end if;
      update public.orders set fulfillment_status = 'cancelled' where id = o.id;
      insert into public.order_status_events (order_id, field, from_value, to_value, actor_id, actor_kind, reason, customer_visible)
      values (o.id, 'fulfillment_status', o.fulfillment_status, 'cancelled', (select auth.uid()), 'staff', 'Order cancelled after review', true);
    end if;
    perform private.restock_order(o.id, 'Order ' || o.order_number || ' cancelled');
    if o.payment_status = 'cod_pending' then
      update public.orders set payment_status = 'voided' where id = o.id;
      insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible)
      values (o.id, 'payment_status', 'cod_pending', 'voided', 'system', false);
    end if;
  end if;

  if p_field = 'shipment_status' and p_to = 'returned' then
    perform private.restock_order(o.id, 'Order ' || o.order_number || ' returned to sender (received)');
    if o.payment_status = 'cod_pending' then
      update public.orders set payment_status = 'voided' where id = o.id;
      insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible)
      values (o.id, 'payment_status', 'cod_pending', 'voided', 'system', false);
    end if;
  end if;

  perform private.write_audit('order.' || p_field, 'order', o.id::text,
    jsonb_build_object(p_field, v_from), jsonb_build_object(p_field, p_to), v_reason);

  return jsonb_build_object('order_id', o.id, 'field', p_field, 'status', p_to, 'changed', true);
end;
$$;
revoke all on function public.admin_order_transition(uuid, text, text, text) from public;
grant execute on function public.admin_order_transition(uuid, text, text, text) to authenticated;

create or replace function public.admin_set_shipment(
  p_order_id uuid, p_courier text, p_courier_name text, p_tracking_number text, p_tracking_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('orders.fulfill') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id and fulfillment_status <> 'cancelled') then
    raise exception 'order not found or cancelled' using errcode = 'P0002';
  end if;
  insert into public.shipments (order_id, courier, courier_name, tracking_number, tracking_url, updated_by)
  values (p_order_id, p_courier, nullif(btrim(p_courier_name), ''), nullif(btrim(p_tracking_number), ''),
          nullif(btrim(p_tracking_url), ''), (select auth.uid()))
  on conflict (order_id) do update set courier = excluded.courier, courier_name = excluded.courier_name,
     tracking_number = excluded.tracking_number, tracking_url = excluded.tracking_url, updated_by = excluded.updated_by;
  perform private.write_audit('order.shipment', 'order', p_order_id::text, null,
    jsonb_build_object('courier', p_courier, 'tracking_number', p_tracking_number), null);
end;
$$;
revoke all on function public.admin_set_shipment(uuid, text, text, text, text) from public;
grant execute on function public.admin_set_shipment(uuid, text, text, text, text) to authenticated;

create or replace function public.admin_flag_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('risk.review') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  insert into public.risk_signals (order_id, rule_code, level, explanation)
  values (p_order_id, 'manual_flag', 'medium', left(btrim(p_reason), 300));
  perform public.admin_order_transition(p_order_id, 'risk_review_status', 'needs_review', p_reason);
end;
$$;
revoke all on function public.admin_flag_order(uuid, text) from public;
grant execute on function public.admin_flag_order(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Scheduled jobs (pg_cron). Reservation expiry matters once online payments
-- hold stock; risk-signal retention keeps security data short-lived.
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;

create or replace function private.purge_old_risk_signals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days int;
  v_n int;
begin
  select signal_retention_days into v_days from private.risk_settings;
  delete from public.risk_signals where created_at < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.purge_old_risk_signals() from public;

select cron.schedule('release-expired-reservations', '* * * * *', 'select public.release_expired_reservations(500)');
select cron.schedule('purge-old-risk-signals', '17 3 * * *', 'select private.purge_old_risk_signals()');
