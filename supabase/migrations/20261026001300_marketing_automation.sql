-- =============================================================================
-- 0013 — Marketing, coupons and automation (slice 7)
--
--   * promotions (coupon codes + automatic discounts) evaluated ONLY in the
--     database (private.evaluate_promotions) and committed atomically by
--     create_order with redemption limits re-checked under row locks.
--   * newsletter with double opt-in, consent events and a suppression list
--     (unsubscribes). Marketing messages are refused for anyone not opted in.
--   * marketing_events: a de-duplicated event stream emitted by triggers from
--     order status changes, try-on jobs, stock levels, signups and a cron job
--     for abandoned carts / weekly summaries.
--   * automation_rules (trigger → conditions → action, as data, never code),
--     versioned, with dry-run mode, per-rule hourly quota, idempotent
--     executions (one per rule+event) and a notification_outbox with retry,
--     dead-letter and suppression states. Outbound webhooks must target an
--     allowlisted host (checked here and again by the dispatcher).
--   * email/sms/whatsapp templates (text only, {{placeholders}}),
--     campaigns + segments, integration connection metadata (secret NAMES
--     only, never values), attribution events (consent-aware).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Promotions
-- -----------------------------------------------------------------------------
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('coupon', 'automatic')),
  code text unique check (code is null or code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  discount_type text not null check (discount_type in ('percent', 'fixed', 'free_shipping')),
  discount_value integer not null default 0 check (discount_value >= 0),
  max_discount_minor bigint check (max_discount_minor is null or max_discount_minor > 0),
  scope text not null default 'order' check (scope in ('order', 'categories', 'collections', 'variants')),
  target_ids uuid[] not null default '{}',
  min_subtotal_minor bigint not null default 0 check (min_subtotal_minor >= 0),
  first_order_only boolean not null default false,
  once_per_customer boolean not null default false,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  priority integer not null default 100,
  stackable boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_code_for_coupons check ((kind = 'coupon') = (code is not null)),
  constraint promotions_value_sane check (
    (discount_type = 'percent' and discount_value between 1 and 100)
    or (discount_type = 'fixed' and discount_value > 0)
    or (discount_type = 'free_shipping' and discount_value = 0)),
  constraint promotions_scope_targets check ((scope = 'order') = (cardinality(target_ids) = 0)),
  constraint promotions_targets_bounded check (cardinality(target_ids) <= 200),
  constraint promotions_dates check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create index promotions_automatic_idx on public.promotions(priority, id) where kind = 'automatic' and is_active;
create trigger promotions_updated_at before update on public.promotions
  for each row execute function private.set_updated_at();
create trigger promotions_audit after insert or update or delete on public.promotions
  for each row execute function private.audit_row_change();

-- Codes are case-insensitive for customers: stored upper-case.
create or replace function private.promotions_normalise()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.code := nullif(upper(btrim(coalesce(new.code, ''))), '');
  if tg_op = 'UPDATE' and coalesce(current_setting('fabriklo.redeem', true), '0') <> '1' then
    new.redemption_count := old.redemption_count; -- only create_order moves this
  end if;
  return new;
end;
$$;
revoke all on function private.promotions_normalise() from public;
create trigger promotions_normalise before insert or update on public.promotions
  for each row execute function private.promotions_normalise();

alter table public.promotions enable row level security;
grant select, insert, update, delete on public.promotions to authenticated;
create policy "marketing read promotions" on public.promotions
  for select to authenticated using ((select private.has_permission('marketing.read')));
create policy "marketing write promotions" on public.promotions
  for all to authenticated
  using ((select private.has_permission('marketing.manage')))
  with check ((select private.has_permission('marketing.manage')));

create table public.coupon_redemptions (
  id bigint generated always as identity primary key,
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  user_id uuid,
  phone text,
  email extensions.citext,
  discount_minor bigint not null check (discount_minor >= 0),
  free_shipping boolean not null default false,
  created_at timestamptz not null default now(),
  unique (promotion_id, order_id)
);
create index coupon_redemptions_identity_idx on public.coupon_redemptions(promotion_id, user_id, phone, email);
create trigger coupon_redemptions_append_only before update or delete on public.coupon_redemptions
  for each row execute function private.forbid_mutation();
alter table public.coupon_redemptions enable row level security;
grant select on public.coupon_redemptions to authenticated;
create policy "marketing read redemptions" on public.coupon_redemptions
  for select to authenticated using ((select private.has_permission('marketing.read')));

-- Coupon attempts (brute-force guard, counted per cart). Private schema: not exposed.
create table private.coupon_attempts (
  id bigint generated always as identity primary key,
  cart_id uuid not null,
  code text not null,
  ok boolean not null,
  attempted_at timestamptz not null default now()
);
create index coupon_attempts_cart_idx on private.coupon_attempts(cart_id, attempted_at desc);

alter table public.carts add column coupon_code text check (coupon_code is null or coupon_code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$');
alter table public.orders add column coupon_code text;

-- The part of a cart's subtotal a promotion applies to (0 = nothing eligible).
create or replace function private.promotion_base_minor(p public.promotions, p_cart_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(v.price_minor * ci.quantity), 0)
  from public.cart_items ci
  join public.product_variants v on v.id = ci.variant_id
  join public.products pr on pr.id = v.product_id
  where ci.cart_id = p_cart_id
    and (p.scope = 'order'
      or (p.scope = 'variants' and v.id = any (p.target_ids))
      or (p.scope = 'categories' and pr.category_id = any (p.target_ids))
      or (p.scope = 'collections' and exists (
            select 1 from public.collection_products cp where cp.product_id = pr.id and cp.collection_id = any (p.target_ids))));
$$;
revoke all on function private.promotion_base_minor(public.promotions, uuid) from public;

create or replace function private.promotion_amount(p public.promotions, p_base bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case p.discount_type
    when 'percent' then least(floor(p_base * p.discount_value / 100.0)::bigint, coalesce(p.max_discount_minor, p_base))
    when 'fixed' then least(p.discount_value::bigint, p_base)
    else 0 end;
$$;
revoke all on function private.promotion_amount(public.promotions, bigint) from public;

-- Why a promotion does not apply for this cart/customer (null = applies).
-- Customer identity may be partial at quote time (anonymous); create_order
-- re-runs this with the phone and email from the order form.
create or replace function private.promotion_block(
  p public.promotions, p_cart_id uuid, p_subtotal bigint, p_user_id uuid, p_phone text, p_email text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base bigint;
begin
  if not p.is_active then return 'inactive'; end if;
  if p.starts_at is not null and p.starts_at > now() then return 'not_started'; end if;
  if p.ends_at is not null and p.ends_at <= now() then return 'expired'; end if;
  if p.max_redemptions is not null and p.redemption_count >= p.max_redemptions then return 'exhausted'; end if;
  if p_subtotal < p.min_subtotal_minor then return 'min_subtotal'; end if;
  v_base := private.promotion_base_minor(p, p_cart_id);
  if v_base <= 0 then return 'not_eligible'; end if;
  if p.first_order_only and (p_user_id is not null or p_phone is not null or p_email is not null) and exists (
      select 1 from public.orders o
      where o.fulfillment_status <> 'cancelled'
        and ((p_user_id is not null and o.user_id = p_user_id)
          or (p_phone is not null and o.customer_phone = p_phone)
          or (p_email is not null and o.customer_email = p_email::extensions.citext))) then
    return 'first_order';
  end if;
  if p.once_per_customer and (p_user_id is not null or p_phone is not null or p_email is not null) and exists (
      select 1 from public.coupon_redemptions r
      join public.orders o on o.id = r.order_id
      where r.promotion_id = p.id and o.fulfillment_status <> 'cancelled'
        and ((p_user_id is not null and r.user_id = p_user_id)
          or (p_phone is not null and r.phone = p_phone)
          or (p_email is not null and r.email = p_email::extensions.citext))) then
    return 'already_used';
  end if;
  return null;
end;
$$;
revoke all on function private.promotion_block(public.promotions, uuid, bigint, uuid, text, text) from public;

-- Deterministic stacking: the coupon (if any) is considered first, then
-- automatic promotions by (priority, id). A promotion applies when nothing has
-- applied yet, or when it and everything already applied are stackable.
-- Percentages are computed on the eligible subtotal, never compounded; the
-- total discount is capped at the subtotal.
create or replace function private.evaluate_promotions(
  p_cart_id uuid, p_code text, p_user_id uuid, p_phone text, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subtotal bigint;
  p public.promotions;
  v_block text;
  v_amount bigint;
  v_applied jsonb := '[]'::jsonb;
  v_discount bigint := 0;
  v_free_ship boolean := false;
  v_all_stackable boolean := true;
  v_count int := 0;
  v_coupon jsonb := null;
begin
  select coalesce(sum(v.price_minor * ci.quantity), 0) into v_subtotal
  from public.cart_items ci join public.product_variants v on v.id = ci.variant_id
  where ci.cart_id = p_cart_id;

  if p_code is not null then
    select * into p from public.promotions where kind = 'coupon' and code = upper(btrim(p_code));
    if not found then
      v_coupon := jsonb_build_object('code', upper(btrim(p_code)), 'status', 'invalid');
    else
      v_block := private.promotion_block(p, p_cart_id, v_subtotal, p_user_id, p_phone, p_email);
      if v_block is null then
        v_amount := private.promotion_amount(p, private.promotion_base_minor(p, p_cart_id));
        v_applied := v_applied || jsonb_build_object('promotion_id', p.id, 'kind', 'coupon', 'code', p.code, 'name', p.name,
          'discount_minor', v_amount, 'free_shipping', p.discount_type = 'free_shipping', 'stackable', p.stackable);
        v_discount := v_amount;
        v_free_ship := p.discount_type = 'free_shipping';
        v_all_stackable := p.stackable;
        v_count := 1;
        v_coupon := jsonb_build_object('code', p.code, 'name', p.name, 'status', 'applied', 'discount_minor', v_amount,
          'free_shipping', p.discount_type = 'free_shipping', 'min_subtotal_minor', p.min_subtotal_minor);
      else
        v_coupon := jsonb_build_object('code', p.code, 'name', p.name, 'status', v_block, 'min_subtotal_minor', p.min_subtotal_minor);
      end if;
    end if;
  end if;

  for p in select * from public.promotions where kind = 'automatic' and is_active order by priority, id loop
    if v_count > 0 and not (p.stackable and v_all_stackable) then
      continue;
    end if;
    v_block := private.promotion_block(p, p_cart_id, v_subtotal, p_user_id, p_phone, p_email);
    if v_block is not null then
      continue;
    end if;
    v_amount := private.promotion_amount(p, private.promotion_base_minor(p, p_cart_id));
    v_applied := v_applied || jsonb_build_object('promotion_id', p.id, 'kind', 'automatic', 'code', null, 'name', p.name,
      'discount_minor', v_amount, 'free_shipping', p.discount_type = 'free_shipping', 'stackable', p.stackable);
    v_discount := v_discount + v_amount;
    v_free_ship := v_free_ship or p.discount_type = 'free_shipping';
    v_all_stackable := v_all_stackable and p.stackable;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('discount_minor', least(v_discount, v_subtotal), 'free_shipping', v_free_ship,
    'applied', v_applied, 'coupon', v_coupon);
end;
$$;
revoke all on function private.evaluate_promotions(uuid, text, uuid, text, text) from public;

-- Quote: now with discounts. The old 2-argument form is dropped (a defaulted
-- overload would be ambiguous).
drop function private.quote_cart(uuid, text);
create or replace function private.quote_cart(p_cart_id uuid, p_district text, p_phone text default null, p_email text default null)
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
  v_code text;
  v_promo jsonb;
  v_discount bigint;
  v_total bigint;
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

  select coupon_code into v_code from public.carts where id = p_cart_id;
  v_promo := private.evaluate_promotions(p_cart_id, v_code, (select auth.uid()), p_phone, p_email);
  v_discount := (v_promo ->> 'discount_minor')::bigint;

  if p_district is not null then
    v_zone := private.zone_for_district(p_district);
  end if;
  v_fee := case when v_zone.id is null then null
                when (v_promo ->> 'free_shipping')::boolean then 0
                when v_zone.free_over_minor is not null and v_subtotal >= v_zone.free_over_minor then 0
                else v_zone.fee_minor end;
  v_total := case when v_fee is null then null else v_subtotal - v_discount + v_fee end;
  select value into v_cod from public.site_settings where key = 'checkout.cod';

  return jsonb_build_object(
    'currency', 'BDT',
    'lines', v_lines,
    'issues', v_issues,
    'subtotal_minor', v_subtotal,
    'discount_minor', v_discount,
    'promotions', v_promo -> 'applied',
    'coupon', v_promo -> 'coupon',
    'tax_minor', 0,
    'shipping_minor', v_fee,
    'total_minor', v_total,
    'zone', case when v_zone.id is null then null else jsonb_build_object(
        'code', v_zone.code, 'name', v_zone.name, 'min_days', v_zone.estimate_min_days, 'max_days', v_zone.estimate_max_days) end,
    'district_known', p_district is null or exists (select 1 from public.bd_districts d where d.district = p_district),
    'cod_available', v_zone.id is not null and v_zone.cod_enabled
        and coalesce((v_cod ->> 'enabled')::boolean, false)
        and coalesce(v_total, v_subtotal - v_discount) <= coalesce((v_cod ->> 'max_order_minor')::bigint, 0),
    'cod_max_order_minor', (v_cod ->> 'max_order_minor')::bigint
  );
end;
$$;
revoke all on function private.quote_cart(uuid, text, text, text) from public;

-- Customers apply / remove a coupon on their cart. The code is stored only when
-- it currently applies; the quote re-evaluates it on every call.
create or replace function public.cart_apply_coupon(p_cart_token text, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_promo jsonb;
  v_recent int;
begin
  v_cart := private.cart_by_token(p_cart_token);
  if v_cart.id is null then
    raise exception 'cart not found' using errcode = 'P0002', hint = 'cart_missing';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
    return jsonb_build_object('code', left(v_code, 32), 'status', 'invalid');
  end if;
  select count(*) into v_recent from private.coupon_attempts
   where cart_id = v_cart.id and attempted_at > now() - interval '10 minutes';
  if v_recent >= 15 then
    raise exception 'too many coupon attempts' using errcode = 'P0001', hint = 'too_many_attempts';
  end if;
  v_promo := private.evaluate_promotions(v_cart.id, v_code, (select auth.uid()), null, null);
  insert into private.coupon_attempts (cart_id, code, ok) values (v_cart.id, v_code, (v_promo -> 'coupon' ->> 'status') = 'applied');
  if (v_promo -> 'coupon' ->> 'status') = 'applied' then
    update public.carts set coupon_code = v_code where id = v_cart.id;
  end if;
  return v_promo -> 'coupon';
end;
$$;
revoke all on function public.cart_apply_coupon(text, text) from public;
grant execute on function public.cart_apply_coupon(text, text) to anon, authenticated;

create or replace function public.cart_remove_coupon(p_cart_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
begin
  v_cart := private.cart_by_token(p_cart_token);
  if v_cart.id is null then
    return false;
  end if;
  update public.carts set coupon_code = null where id = v_cart.id and coupon_code is not null;
  return true;
end;
$$;
revoke all on function public.cart_remove_coupon(text) from public;
grant execute on function public.cart_remove_coupon(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Attribution (consent-aware: written only when the customer allowed analytics)
-- -----------------------------------------------------------------------------
create table public.attribution_events (
  id bigint generated always as identity primary key,
  order_id uuid references public.orders(id) on delete set null,
  utm_source text check (utm_source is null or char_length(utm_source) <= 100),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 100),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 150),
  utm_content text check (utm_content is null or char_length(utm_content) <= 150),
  utm_term text check (utm_term is null or char_length(utm_term) <= 150),
  landing_path text check (landing_path is null or char_length(landing_path) <= 300),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 200),
  first_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index attribution_events_order_idx on public.attribution_events(order_id);
create index attribution_events_created_idx on public.attribution_events(created_at desc);
alter table public.attribution_events enable row level security;
grant select on public.attribution_events to authenticated;
create policy "marketing read attribution" on public.attribution_events
  for select to authenticated using ((select private.has_permission('marketing.read')));

-- -----------------------------------------------------------------------------
-- create_order: discounts committed atomically, coupon limits re-checked under
-- row locks, redemptions recorded, attribution stored when consented.
-- -----------------------------------------------------------------------------
drop function public.create_order(text, text, jsonb, jsonb, text, bigint, text);
create or replace function public.create_order(
  p_cart_token text,
  p_idempotency_key text,
  p_customer jsonb,
  p_address jsonb,
  p_payment_method text,
  p_expected_total_minor bigint,
  p_note text default null,
  p_attribution jsonb default null)
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
  v_online jsonb;
  v_hold_minutes int;
  v_applied jsonb;
  v_promo public.promotions;
  v_coupon_code text;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$' then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number,
      'tracking_token', private.tracking_token(v_existing.id), 'total_minor', v_existing.total_minor,
      'payment_method', v_existing.payment_method, 'payment_status', v_existing.payment_status, 'replayed', true);
  end if;

  if p_payment_method not in ('cod', 'sslcommerz') then
    raise exception 'payment method not available' using errcode = '22023', hint = 'payment_unavailable';
  end if;
  if p_payment_method = 'sslcommerz' then
    select value into v_online from public.site_settings where key = 'checkout.online';
    if not coalesce((v_online ->> 'enabled')::boolean, false) then
      raise exception 'online payment is not available' using errcode = '22023', hint = 'payment_unavailable';
    end if;
    v_hold_minutes := least(greatest(coalesce((v_online ->> 'hold_minutes')::int, 30), 10), 120);
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
  perform 1 from public.carts where id = v_cart.id for update;
  if (select status from public.carts where id = v_cart.id) <> 'active' then
    raise exception 'cart already checked out' using errcode = 'P0002', hint = 'cart_missing';
  end if;

  -- Lock every active promotion row that could apply so limits are checked serially.
  perform 1 from public.promotions where is_active and (kind = 'automatic' or code = v_cart.coupon_code) order by id for update;

  v_quote := private.quote_cart(v_cart.id, v_district, v_phone, v_email);
  if jsonb_array_length(v_quote -> 'lines') = 0 then
    raise exception 'cart is empty' using errcode = '22023', hint = 'cart_empty';
  end if;
  if jsonb_array_length(v_quote -> 'issues') > 0 then
    raise exception 'some items are no longer available' using errcode = 'P0001', hint = 'stock_unavailable';
  end if;
  if (v_quote ->> 'total_minor') is null then
    raise exception 'delivery is not available to this district' using errcode = 'P0001', hint = 'no_delivery';
  end if;
  if v_cart.coupon_code is not null and coalesce(v_quote -> 'coupon' ->> 'status', 'invalid') <> 'applied' then
    -- The code applied at quote time but not for this customer (first-order /
    -- one-use rules) or it ran out. Drop it and let the customer see the new total.
    raise exception 'coupon no longer applies: %', coalesce(v_quote -> 'coupon' ->> 'status', 'invalid')
      using errcode = 'P0001', hint = 'coupon_invalid';
  end if;
  if (v_quote ->> 'total_minor')::bigint <> p_expected_total_minor then
    raise exception 'prices or delivery fee changed; please review the new total' using errcode = 'P0001', hint = 'quote_changed';
  end if;
  if p_payment_method = 'cod' and not (v_quote ->> 'cod_available')::boolean then
    raise exception 'cash on delivery is not available for this order' using errcode = 'P0001', hint = 'cod_unavailable';
  end if;
  if p_payment_method = 'sslcommerz' and (v_quote ->> 'total_minor')::bigint < 1000 then
    raise exception 'online payment needs a total of at least 10 taka' using errcode = 'P0001', hint = 'payment_unavailable';
  end if;

  v_applied := coalesce(v_quote -> 'promotions', '[]'::jsonb);
  select string_agg(a ->> 'code', ',') into v_coupon_code from jsonb_array_elements(v_applied) a where a ->> 'kind' = 'coupon';

  insert into public.orders (user_id, cart_id, idempotency_key, customer_name, customer_phone, customer_email,
      shipping_address, subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor,
      payment_method, payment_status, customer_note, is_demo, coupon_code)
  values ((select auth.uid()), v_cart.id, p_idempotency_key, v_name, v_phone, v_email,
      jsonb_build_object('recipient_name', v_name, 'phone', v_phone, 'division', v_division, 'district', v_district,
                         'area', v_area, 'address_line', v_line, 'postal_code', v_postal,
                         'zone', v_quote -> 'zone'),
      (v_quote ->> 'subtotal_minor')::bigint, (v_quote ->> 'discount_minor')::bigint, (v_quote ->> 'shipping_minor')::bigint, 0,
      (v_quote ->> 'total_minor')::bigint, p_payment_method,
      case when p_payment_method = 'cod' then 'cod_pending' else 'awaiting_payment' end,
      nullif(btrim(coalesce(p_note, '')), ''),
      exists (select 1 from public.cart_items ci join public.product_variants v on v.id = ci.variant_id
              join public.products p on p.id = v.product_id where ci.cart_id = v_cart.id and p.is_demo),
      v_coupon_code)
  returning * into v_order;

  -- Redemptions: counted once per promotion per order, limits enforced under the lock above.
  perform set_config('fabriklo.redeem', '1', true);
  for v_item in select * from jsonb_array_elements(v_applied) loop
    select * into v_promo from public.promotions where id = (v_item.value ->> 'promotion_id')::uuid for update;
    if v_promo.max_redemptions is not null and v_promo.redemption_count >= v_promo.max_redemptions then
      raise exception 'promotion exhausted' using errcode = 'P0001', hint = 'coupon_invalid';
    end if;
    update public.promotions set redemption_count = redemption_count + 1 where id = v_promo.id;
    insert into public.coupon_redemptions (promotion_id, order_id, user_id, phone, email, discount_minor, free_shipping)
    values (v_promo.id, v_order.id, (select auth.uid()), v_phone, v_email::extensions.citext,
            (v_item.value ->> 'discount_minor')::bigint, (v_item.value ->> 'free_shipping')::boolean);
  end loop;
  perform set_config('fabriklo.redeem', '0', true);

  for v_item in
    select ci.variant_id, ci.quantity, v.sku, v.size, v.color, v.price_minor, p.title
    from public.cart_items ci
    join public.product_variants v on v.id = ci.variant_id
    join public.products p on p.id = v.product_id
    where ci.cart_id = v_cart.id
    order by v.id
  loop
    v_res := private.reserve_stock(v_item.variant_id, v_item.quantity, v_order.id,
      'order:' || v_order.id::text || ':' || v_item.variant_id::text, v_hold_minutes);
    if p_payment_method = 'cod' then
      perform private.close_reservation(v_res.id, 'committed');
    end if;
    insert into public.order_items (order_id, variant_id, product_title, sku, size, color, unit_price_minor, quantity,
        line_total_minor, reservation_id)
    values (v_order.id, v_item.variant_id, v_item.title, v_item.sku, v_item.size, v_item.color, v_item.price_minor,
        v_item.quantity, v_item.price_minor * v_item.quantity, v_res.id);
  end loop;

  update public.carts set status = 'converted' where id = v_cart.id;

  if p_attribution is not null and jsonb_typeof(p_attribution) = 'object' then
    insert into public.attribution_events (order_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        landing_path, referrer_host, first_seen_at)
    values (v_order.id, left(p_attribution ->> 'utm_source', 100), left(p_attribution ->> 'utm_medium', 100),
        left(p_attribution ->> 'utm_campaign', 150), left(p_attribution ->> 'utm_content', 150), left(p_attribution ->> 'utm_term', 150),
        left(p_attribution ->> 'landing_path', 300), left(p_attribution ->> 'referrer_host', 200),
        nullif(p_attribution ->> 'first_seen_at', '')::timestamptz);
  end if;

  v_risk := private.evaluate_order_risk(v_order.id);
  update public.orders
     set tracking_token_hash = extensions.digest(private.tracking_token(v_order.id), 'sha256'),
         risk_level = v_risk,
         risk_review_status = case when v_risk in ('medium', 'high') then 'needs_review' else 'not_required' end
   where id = v_order.id;

  insert into public.order_status_events (order_id, field, from_value, to_value, actor_id, actor_kind, customer_visible, reason)
  values (v_order.id, 'created', null, 'placed', (select auth.uid()), 'customer', true,
          case when p_payment_method = 'cod' then 'Order placed (cash on delivery)' else 'Order placed (online payment pending)' end);
  if v_risk in ('medium', 'high') then
    insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible, reason)
    values (v_order.id, 'risk_review_status', 'not_required', 'needs_review', 'system', false, 'Automatic rules flagged this order for a quick check');
  end if;

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
    'tracking_token', private.tracking_token(v_order.id), 'total_minor', v_order.total_minor,
    'payment_method', v_order.payment_method, 'payment_status', v_order.payment_status, 'replayed', false);
end;
$$;
revoke all on function public.create_order(text, text, jsonb, jsonb, text, bigint, text, jsonb) from public;
grant execute on function public.create_order(text, text, jsonb, jsonb, text, bigint, text, jsonb) to anon, authenticated;

-- track_order and admin views: expose the coupon code.
-- (track_order already returns discount_minor; the admin page reads orders.coupon_code directly.)

-- -----------------------------------------------------------------------------
-- Newsletter, consent and suppression
-- -----------------------------------------------------------------------------
create table public.newsletter_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  status text not null default 'pending' check (status in ('pending', 'subscribed', 'unsubscribed')),
  source text not null default 'site' check (char_length(source) <= 40),
  user_id uuid references auth.users(id) on delete set null,
  confirm_token_hash bytea,
  unsubscribe_token_hash bytea not null,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index newsletter_status_idx on public.newsletter_subscriptions(status, created_at desc);
create trigger newsletter_updated_at before update on public.newsletter_subscriptions
  for each row execute function private.set_updated_at();
alter table public.newsletter_subscriptions enable row level security;
grant select on public.newsletter_subscriptions to authenticated;
-- Staff see the list but never the token hashes (column-level grant below).
revoke select on public.newsletter_subscriptions from authenticated;
grant select (id, email, status, source, user_id, confirmed_at, unsubscribed_at, created_at, updated_at) on public.newsletter_subscriptions to authenticated;
create policy "marketing read newsletter" on public.newsletter_subscriptions
  for select to authenticated using ((select private.has_permission('marketing.read')));

create table public.consent_events (
  id bigint generated always as identity primary key,
  email extensions.citext,
  phone text,
  user_id uuid,
  channel text not null check (channel in ('email_marketing', 'sms_marketing', 'whatsapp_marketing', 'analytics', 'marketing_cookies')),
  action text not null check (action in ('granted', 'revoked')),
  source text not null check (char_length(source) <= 60),
  ip_hash text,
  occurred_at timestamptz not null default now()
);
create index consent_events_email_idx on public.consent_events(email, occurred_at desc);
create trigger consent_events_append_only before update or delete on public.consent_events
  for each row execute function private.forbid_mutation();
alter table public.consent_events enable row level security;
grant select on public.consent_events to authenticated;
create policy "marketing read consent" on public.consent_events
  for select to authenticated using ((select private.has_permission('marketing.read')));

-- Suppression list: identifier is a lower-cased email or an E.164 phone.
create table public.unsubscribes (
  id bigint generated always as identity primary key,
  identifier extensions.citext not null check (char_length(identifier) <= 254),
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'all')),
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  unique (identifier, channel)
);
alter table public.unsubscribes enable row level security;
grant select, insert, delete on public.unsubscribes to authenticated;
create policy "marketing read unsubscribes" on public.unsubscribes
  for select to authenticated using ((select private.has_permission('marketing.read')));
create policy "marketing manage unsubscribes" on public.unsubscribes
  for all to authenticated
  using ((select private.has_permission('marketing.manage')))
  with check ((select private.has_permission('marketing.manage')));

-- May a MARKETING message go to this recipient on this channel?
-- Transactional messages (order updates) do not go through this check.
create or replace function private.marketing_allowed(p_channel text, p_recipient text, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id extensions.citext := lower(btrim(coalesce(p_recipient, '')))::extensions.citext;
  v_opted boolean := false;
begin
  if p_recipient is null or p_channel not in ('email', 'sms', 'whatsapp') then
    return false;
  end if;
  if exists (select 1 from public.unsubscribes u where u.identifier = v_id and u.channel in (p_channel, 'all')) then
    return false;
  end if;
  if p_user_id is not null then
    select marketing_opt_in into v_opted from public.profiles where id = p_user_id;
  end if;
  if not coalesce(v_opted, false) and p_channel = 'email' then
    v_opted := exists (select 1 from public.newsletter_subscriptions n where n.email = v_id and n.status = 'subscribed');
  end if;
  if not coalesce(v_opted, false) and p_user_id is null then
    v_opted := exists (select 1 from public.profiles pr join auth.users u on u.id = pr.id
                       where pr.marketing_opt_in and (u.email::extensions.citext = v_id or pr.phone = p_recipient));
  end if;
  return coalesce(v_opted, false);
end;
$$;
revoke all on function private.marketing_allowed(text, text, uuid) from public;

-- Profile opt-in changes write consent events and keep the suppression list in step.
create or replace function private.profile_consent_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if tg_op = 'UPDATE' and new.marketing_opt_in is distinct from old.marketing_opt_in then
    select email into v_email from auth.users where id = new.id;
    insert into public.consent_events (email, phone, user_id, channel, action, source)
    values (v_email::extensions.citext, new.phone, new.id, 'email_marketing', case when new.marketing_opt_in then 'granted' else 'revoked' end, 'account');
    if new.marketing_opt_in then
      delete from public.unsubscribes where identifier = v_email::extensions.citext and channel in ('email', 'all');
      if new.phone is not null then
        delete from public.unsubscribes where identifier = new.phone::extensions.citext and channel in ('sms', 'whatsapp', 'all');
      end if;
    else
      insert into public.unsubscribes (identifier, channel, reason) values (v_email::extensions.citext, 'all', 'account opt-out')
      on conflict (identifier, channel) do nothing;
      if new.phone is not null then
        insert into public.unsubscribes (identifier, channel, reason) values (new.phone::extensions.citext, 'all', 'account opt-out')
        on conflict (identifier, channel) do nothing;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.profile_consent_sync() from public;
create trigger profiles_consent_sync after update on public.profiles
  for each row execute function private.profile_consent_sync();

-- Audit triggers use the primary key column "id"; these tables key on "key".
create or replace function private.audit_keyed_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.write_audit('delete', tg_table_name, (to_jsonb(old) ->> 'key'), to_jsonb(old), null, null);
    return old;
  end if;
  perform private.write_audit(lower(tg_op), tg_table_name, (to_jsonb(new) ->> 'key'),
    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), null);
  return new;
end;
$$;
revoke all on function private.audit_keyed_row_change() from public;

-- -----------------------------------------------------------------------------
-- Templates (text only; {{placeholders}} rendered by the dispatcher with escaping)
-- -----------------------------------------------------------------------------
create table public.email_templates (
  key text primary key check (key ~ '^[a-z0-9_]{3,60}$'),
  name text not null check (char_length(name) between 2 and 120),
  subject text not null check (char_length(subject) between 1 and 200),
  body_text text not null check (char_length(body_text) between 1 and 10000),
  message_class text not null default 'transactional' check (message_class in ('transactional', 'marketing')),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create table public.sms_templates (
  key text primary key check (key ~ '^[a-z0-9_]{3,60}$'),
  name text not null check (char_length(name) between 2 and 120),
  body_text text not null check (char_length(body_text) between 1 and 480),
  message_class text not null default 'transactional' check (message_class in ('transactional', 'marketing')),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create table public.whatsapp_templates (
  key text primary key check (key ~ '^[a-z0-9_]{3,60}$'),
  name text not null check (char_length(name) between 2 and 120),
  provider_template_name text not null check (char_length(provider_template_name) between 1 and 120),
  language_code text not null default 'en' check (language_code ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  variables text[] not null default '{}' check (cardinality(variables) <= 20),
  message_class text not null default 'transactional' check (message_class in ('transactional', 'marketing')),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger email_templates_updated_at before update on public.email_templates for each row execute function private.set_updated_at();
create trigger sms_templates_updated_at before update on public.sms_templates for each row execute function private.set_updated_at();
create trigger whatsapp_templates_updated_at before update on public.whatsapp_templates for each row execute function private.set_updated_at();
create trigger email_templates_audit after insert or update or delete on public.email_templates for each row execute function private.audit_keyed_row_change();
create trigger sms_templates_audit after insert or update or delete on public.sms_templates for each row execute function private.audit_keyed_row_change();
create trigger whatsapp_templates_audit after insert or update or delete on public.whatsapp_templates for each row execute function private.audit_keyed_row_change();
alter table public.email_templates enable row level security;
alter table public.sms_templates enable row level security;
alter table public.whatsapp_templates enable row level security;
grant select, insert, update, delete on public.email_templates, public.sms_templates, public.whatsapp_templates to authenticated;
create policy "marketing read email templates" on public.email_templates for select to authenticated using ((select private.has_permission('marketing.read')));
create policy "marketing write email templates" on public.email_templates for all to authenticated using ((select private.has_permission('marketing.manage'))) with check ((select private.has_permission('marketing.manage')));
create policy "marketing read sms templates" on public.sms_templates for select to authenticated using ((select private.has_permission('marketing.read')));
create policy "marketing write sms templates" on public.sms_templates for all to authenticated using ((select private.has_permission('marketing.manage'))) with check ((select private.has_permission('marketing.manage')));
create policy "marketing read whatsapp templates" on public.whatsapp_templates for select to authenticated using ((select private.has_permission('marketing.read')));
create policy "marketing write whatsapp templates" on public.whatsapp_templates for all to authenticated using ((select private.has_permission('marketing.manage'))) with check ((select private.has_permission('marketing.manage')));

-- -----------------------------------------------------------------------------
-- Notification outbox (every outbound message, whatever the channel)
-- -----------------------------------------------------------------------------
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'webhook', 'internal')),
  message_class text not null check (message_class in ('transactional', 'marketing', 'internal')),
  recipient text check (recipient is null or char_length(recipient) <= 2000),
  user_id uuid,
  template_key text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'dead', 'suppressed')),
  suppressed_reason text check (suppressed_reason is null or char_length(suppressed_reason) <= 120),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  provider text check (provider is null or char_length(provider) <= 40),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  dedupe_key text unique check (dedupe_key is null or char_length(dedupe_key) <= 200),
  rule_id uuid,
  event_id bigint,
  campaign_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbox_due_idx on public.notification_outbox(next_attempt_at) where status = 'queued';
create index outbox_status_idx on public.notification_outbox(status, created_at desc);
create index outbox_rule_hour_idx on public.notification_outbox(rule_id, created_at desc) where rule_id is not null;
create trigger outbox_updated_at before update on public.notification_outbox
  for each row execute function private.set_updated_at();
alter table public.notification_outbox enable row level security;
grant select on public.notification_outbox to authenticated;
create policy "automation read outbox" on public.notification_outbox
  for select to authenticated using ((select private.has_permission('automation.manage')) or (select private.has_permission('marketing.read')));

create table public.webhook_events (
  id bigint generated always as identity primary key,
  outbox_id uuid not null,
  url_host text not null,
  attempt integer not null,
  status_code integer,
  ok boolean not null,
  response_excerpt text check (response_excerpt is null or char_length(response_excerpt) <= 300),
  created_at timestamptz not null default now()
);
create index webhook_events_outbox_idx on public.webhook_events(outbox_id, created_at desc);
create trigger webhook_events_append_only before update or delete on public.webhook_events
  for each row execute function private.forbid_mutation();
alter table public.webhook_events enable row level security;
grant select on public.webhook_events to authenticated;
create policy "automation read webhook events" on public.webhook_events
  for select to authenticated using ((select private.has_permission('automation.manage')));

-- Single entry point for queuing a message. Marketing messages to anyone not
-- opted in (or suppressed) are stored as 'suppressed' and never sent.
create or replace function private.outbox_enqueue(
  p_channel text, p_message_class text, p_recipient text, p_user_id uuid, p_template_key text, p_payload jsonb,
  p_dedupe_key text, p_rule_id uuid default null, p_event_id bigint default null, p_campaign_id uuid default null)
returns public.notification_outbox
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text := 'queued';
  v_reason text := null;
  v_row public.notification_outbox;
begin
  if p_channel in ('email', 'sms', 'whatsapp') and nullif(btrim(coalesce(p_recipient, '')), '') is null then
    v_status := 'suppressed'; v_reason := 'no_recipient';
  elsif p_channel = 'email' and p_recipient !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_status := 'suppressed'; v_reason := 'invalid_recipient';
  elsif p_channel in ('sms', 'whatsapp') and p_recipient !~ '^\+[1-9][0-9]{7,14}$' then
    v_status := 'suppressed'; v_reason := 'invalid_recipient';
  elsif p_channel in ('email', 'sms', 'whatsapp') and exists (
      select 1 from public.unsubscribes u where u.identifier = lower(p_recipient)::extensions.citext and u.channel = 'all'
        and p_message_class = 'marketing') then
    v_status := 'suppressed'; v_reason := 'unsubscribed';
  elsif p_message_class = 'marketing' and not private.marketing_allowed(p_channel, p_recipient, p_user_id) then
    v_status := 'suppressed'; v_reason := 'no_consent';
  end if;
  if p_channel = 'internal' then
    v_status := 'sent';
  end if;
  insert into public.notification_outbox (channel, message_class, recipient, user_id, template_key, payload, status,
      suppressed_reason, dedupe_key, rule_id, event_id, campaign_id, sent_at)
  values (p_channel, p_message_class, p_recipient, p_user_id, p_template_key, coalesce(p_payload, '{}'::jsonb), v_status,
      v_reason, p_dedupe_key, p_rule_id, p_event_id, p_campaign_id, case when v_status = 'sent' then now() end)
  on conflict (dedupe_key) do nothing
  returning * into v_row;
  return v_row; -- null row when de-duplicated
end;
$$;
revoke all on function private.outbox_enqueue(text, text, text, uuid, text, jsonb, text, uuid, bigint, uuid) from public;

-- -----------------------------------------------------------------------------
-- Newsletter RPCs
-- -----------------------------------------------------------------------------
-- Subscribe (service_role only: the API route rate-limits and hashes the IP).
-- Always answers the same shape so the API cannot leak who is subscribed.
create or replace function public.newsletter_subscribe(p_email text, p_source text, p_ip_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email extensions.citext := lower(btrim(coalesce(p_email, '')))::extensions.citext;
  v_row public.newsletter_subscriptions;
  v_exists boolean;
  v_confirm text := encode(extensions.gen_random_bytes(24), 'hex');
  v_unsub text := encode(extensions.gen_random_bytes(24), 'hex');
  v_uid uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'invalid email' using errcode = '22023', hint = 'invalid_email';
  end if;
  select * into v_row from public.newsletter_subscriptions where email = v_email for update;
  v_exists := found;
  if v_exists and v_row.status = 'subscribed' then
    return jsonb_build_object('status', 'subscribed', 'sent', false);
  end if;
  if v_exists and v_row.status = 'pending' and v_row.updated_at > now() - interval '1 hour' then
    return jsonb_build_object('status', 'pending', 'sent', false); -- the link already sent stays valid
  end if;
  select id into v_uid from auth.users where email::extensions.citext = v_email;
  if v_exists then
    update public.newsletter_subscriptions
       set status = 'pending', confirm_token_hash = extensions.digest(v_confirm, 'sha256'), user_id = coalesce(user_id, v_uid),
           source = left(coalesce(p_source, 'site'), 40)
     where id = v_row.id;
  else
    insert into public.newsletter_subscriptions (email, status, source, user_id, confirm_token_hash, unsubscribe_token_hash)
    values (v_email, 'pending', left(coalesce(p_source, 'site'), 40), v_uid, extensions.digest(v_confirm, 'sha256'), extensions.digest(v_unsub, 'sha256'));
  end if;
  insert into public.consent_events (email, user_id, channel, action, source, ip_hash)
  values (v_email, v_uid, 'email_marketing', 'granted', 'newsletter_form_pending', left(p_ip_hash, 64));
  -- Double opt-in: the confirmation mail is transactional (it carries no marketing).
  perform private.outbox_enqueue('email', 'transactional', v_email::text, v_uid, 'newsletter_confirm',
    jsonb_build_object('confirm_token', v_confirm, 'email', v_email::text),
    'newsletter_confirm:' || v_email::text || ':' || to_char(now(), 'YYYYMMDDHH24'));
  return jsonb_build_object('status', 'pending', 'sent', true);
end;
$$;
revoke all on function public.newsletter_subscribe(text, text, text) from public;
grant execute on function public.newsletter_subscribe(text, text, text) to service_role;

create or replace function public.newsletter_confirm(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.newsletter_subscriptions;
  v_unsub text;
begin
  if p_token !~ '^[0-9a-f]{48}$' then
    return jsonb_build_object('ok', false);
  end if;
  select * into v_row from public.newsletter_subscriptions
   where confirm_token_hash = extensions.digest(p_token, 'sha256') and status = 'pending' for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  update public.newsletter_subscriptions set status = 'subscribed', confirmed_at = now(), confirm_token_hash = null, unsubscribed_at = null
   where id = v_row.id;
  delete from public.unsubscribes where identifier = v_row.email and channel in ('email', 'all');
  insert into public.consent_events (email, user_id, channel, action, source)
  values (v_row.email, v_row.user_id, 'email_marketing', 'granted', 'newsletter_double_opt_in');
  return jsonb_build_object('ok', true, 'email', v_row.email::text);
end;
$$;
revoke all on function public.newsletter_confirm(text) from public;
grant execute on function public.newsletter_confirm(text) to anon, authenticated;

create or replace function public.newsletter_unsubscribe(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.newsletter_subscriptions;
begin
  if p_token !~ '^[0-9a-f]{48}$' then
    return jsonb_build_object('ok', false);
  end if;
  select * into v_row from public.newsletter_subscriptions
   where unsubscribe_token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  update public.newsletter_subscriptions set status = 'unsubscribed', unsubscribed_at = now(), confirm_token_hash = null where id = v_row.id;
  insert into public.unsubscribes (identifier, channel, reason) values (v_row.email, 'email', 'newsletter link')
  on conflict (identifier, channel) do nothing;
  if v_row.user_id is not null then
    update public.profiles set marketing_opt_in = false where id = v_row.user_id and marketing_opt_in;
  end if;
  insert into public.consent_events (email, user_id, channel, action, source)
  values (v_row.email, v_row.user_id, 'email_marketing', 'revoked', 'newsletter_unsubscribe_link');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.newsletter_unsubscribe(text) from public;
grant execute on function public.newsletter_unsubscribe(text) to anon, authenticated;

-- The dispatcher derives a stable unsubscribe token per email (HMAC in the
-- server) and registers its hash here before a marketing mail goes out, so the
-- link in every mail keeps working. People without a newsletter row (e.g. an
-- opted-in account) get a 'pending' row that only carries the token.
create or replace function public.newsletter_unsubscribe_token_set(p_email text, p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_token !~ '^[0-9a-f]{48}$' then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  update public.newsletter_subscriptions set unsubscribe_token_hash = extensions.digest(p_token, 'sha256')
   where email = lower(btrim(p_email))::extensions.citext and unsubscribe_token_hash <> extensions.digest(p_token, 'sha256');
  insert into public.newsletter_subscriptions (email, status, source, unsubscribe_token_hash)
  values (lower(btrim(p_email))::extensions.citext, 'pending', 'system', extensions.digest(p_token, 'sha256'))
  on conflict (email) do nothing;
end;
$$;
revoke all on function public.newsletter_unsubscribe_token_set(text, text) from public;
grant execute on function public.newsletter_unsubscribe_token_set(text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Marketing events (the trigger stream for automation)
-- -----------------------------------------------------------------------------
create table public.marketing_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'order.placed', 'payment.verified', 'cod.awaiting_verification', 'order.packed', 'order.delivered',
    'delivery.failed', 'return.requested', 'cart.abandoned', 'stock.low', 'stock.back_in_stock',
    'customer.signup', 'tryon.completed', 'tryon.failed', 'summary.weekly')),
  occurred_at timestamptz not null default now(),
  order_id uuid,
  user_id uuid,
  email extensions.citext,
  phone text,
  variant_id uuid,
  product_id uuid,
  cart_id uuid,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  processed_at timestamptz
);
create index marketing_events_unprocessed_idx on public.marketing_events(id) where processed_at is null;
create index marketing_events_type_idx on public.marketing_events(event_type, occurred_at desc);
create or replace function private.marketing_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'marketing_events is append-only' using errcode = '42501';
  end if;
  -- Only processed_at may change.
  if to_jsonb(new) - 'processed_at' <> to_jsonb(old) - 'processed_at' then
    raise exception 'marketing_events rows are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.marketing_events_guard() from public;
create trigger marketing_events_guard before update or delete on public.marketing_events
  for each row execute function private.marketing_events_guard();
alter table public.marketing_events enable row level security;
grant select on public.marketing_events to authenticated;
create policy "automation read events" on public.marketing_events
  for select to authenticated using ((select private.has_permission('automation.manage')) or (select private.has_permission('marketing.read')));

create or replace function private.emit_marketing_event(
  p_type text, p_dedupe text, p_order_id uuid, p_user_id uuid, p_email text, p_phone text,
  p_variant_id uuid, p_product_id uuid, p_cart_id uuid, p_payload jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.marketing_events (event_type, dedupe_key, order_id, user_id, email, phone, variant_id, product_id, cart_id, payload)
  values (p_type, p_dedupe, p_order_id, p_user_id, nullif(lower(p_email), '')::extensions.citext, p_phone, p_variant_id, p_product_id, p_cart_id,
          coalesce(p_payload, '{}'::jsonb))
  on conflict (dedupe_key) do nothing;
$$;
revoke all on function private.emit_marketing_event(text, text, uuid, uuid, text, text, uuid, uuid, uuid, jsonb) from public;

create or replace function private.order_event_payload(o public.orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number, 'customer_name', o.customer_name, 'total_minor', o.total_minor,
    'discount_minor', o.discount_minor, 'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'fulfillment_status', o.fulfillment_status, 'shipment_status', o.shipment_status, 'district', o.shipping_address ->> 'district',
    'risk_level', o.risk_level, 'is_demo', o.is_demo, 'coupon_code', o.coupon_code,
    'item_count', (select coalesce(sum(quantity), 0) from public.order_items i where i.order_id = o.id));
$$;
revoke all on function private.order_event_payload(public.orders) from public;

-- Orders: every status event already lands in order_status_events; map the ones marketing cares about.
create or replace function private.emit_order_marketing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_type text;
begin
  select * into o from public.orders where id = new.order_id;
  v_type := case
    when new.field = 'created' then 'order.placed'
    when new.field = 'payment_status' and new.to_value = 'paid' then 'payment.verified'
    when new.field = 'fulfillment_status' and new.to_value = 'packed' then 'order.packed'
    when new.field = 'shipment_status' and new.to_value = 'delivered' then 'order.delivered'
    when new.field = 'shipment_status' and new.to_value = 'delivery_failed' then 'delivery.failed'
    when new.field = 'shipment_status' and new.to_value in ('returned', 'rto') then 'return.requested'
    else null end;
  if v_type is not null then
    perform private.emit_marketing_event(v_type, 'order:' || o.id::text || ':' || v_type, o.id, o.user_id, o.customer_email::text, o.customer_phone,
      null, null, o.cart_id, private.order_event_payload(o));
  end if;
  if new.field = 'created' and o.payment_method = 'cod' then
    perform private.emit_marketing_event('cod.awaiting_verification', 'order:' || o.id::text || ':cod.awaiting_verification', o.id, o.user_id,
      o.customer_email::text, o.customer_phone, null, null, o.cart_id, private.order_event_payload(o));
  end if;
  return new;
end;
$$;
revoke all on function private.emit_order_marketing_event() from public;
create trigger order_status_events_marketing after insert on public.order_status_events
  for each row execute function private.emit_order_marketing_event();

-- Try-on outcomes (no photo paths in the payload).
create or replace function private.emit_tryon_marketing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_product uuid;
  v_title text;
begin
  if new.status in ('completed', 'failed') and new.status is distinct from old.status then
    select u.email into v_email from auth.users u where u.id = new.user_id;
    select p.id, p.title into v_product, v_title from public.product_variants v join public.products p on p.id = v.product_id where v.id = new.product_variant_id;
    perform private.emit_marketing_event('tryon.' || new.status, 'tryon:' || new.id::text || ':' || new.status, null, new.user_id, v_email, null,
      new.product_variant_id, v_product, null, jsonb_build_object('product_title', v_title, 'provider', new.provider, 'error_code', new.error_code));
  end if;
  return new;
end;
$$;
revoke all on function private.emit_tryon_marketing_event() from public;
create trigger tryon_jobs_marketing after update on public.tryon_jobs
  for each row execute function private.emit_tryon_marketing_event();

-- Stock: low (crossing the reorder point downwards, once a day per variant) and back in stock.
create or replace function private.emit_stock_marketing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old int := old.on_hand - old.reserved;
  v_new int := new.on_hand - new.reserved;
  v_product uuid;
  v_sku text;
  v_title text;
begin
  if v_new = v_old then return new; end if;
  select p.id, v.sku, p.title into v_product, v_sku, v_title from public.product_variants v join public.products p on p.id = v.product_id where v.id = new.variant_id;
  if v_new <= new.reorder_point and v_old > new.reorder_point then
    perform private.emit_marketing_event('stock.low', 'stock.low:' || new.variant_id::text || ':' || to_char(now(), 'YYYYMMDD'), null, null, null, null,
      new.variant_id, v_product, null, jsonb_build_object('sku', v_sku, 'product_title', v_title, 'available', v_new, 'reorder_point', new.reorder_point));
  end if;
  if v_old <= 0 and v_new > 0 then
    perform private.emit_marketing_event('stock.back_in_stock', 'back:' || new.variant_id::text || ':' || to_char(now(), 'YYYYMMDD'), null, null, null, null,
      new.variant_id, v_product, null, jsonb_build_object('sku', v_sku, 'product_title', v_title, 'available', v_new));
  end if;
  return new;
end;
$$;
revoke all on function private.emit_stock_marketing_event() from public;
create trigger stock_balances_marketing after update on public.stock_balances
  for each row execute function private.emit_stock_marketing_event();

-- Signups.
create or replace function private.emit_signup_marketing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = new.id;
  perform private.emit_marketing_event('customer.signup', 'signup:' || new.id::text, null, new.id, v_email, new.phone, null, null, null,
    jsonb_build_object('full_name', new.full_name));
  return new;
end;
$$;
revoke all on function private.emit_signup_marketing_event() from public;
create trigger profiles_marketing_signup after insert on public.profiles
  for each row execute function private.emit_signup_marketing_event();

-- Abandoned carts (signed-in customers only: guests have no contact details) and the weekly summary.
create or replace function private.emit_scheduled_marketing_events()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c record;
  n int := 0;
  v_week text := to_char(now(), 'IYYY-IW');
begin
  for c in
    select ca.id, ca.user_id, u.email, pr.phone, ca.updated_at,
           (select coalesce(sum(v.price_minor * ci.quantity), 0) from public.cart_items ci join public.product_variants v on v.id = ci.variant_id where ci.cart_id = ca.id) as subtotal,
           (select count(*) from public.cart_items ci where ci.cart_id = ca.id) as items
    from public.carts ca
    join auth.users u on u.id = ca.user_id
    left join public.profiles pr on pr.id = ca.user_id
    where ca.status = 'active' and ca.updated_at between now() - interval '7 days' and now() - interval '1 hour'
      and exists (select 1 from public.cart_items ci where ci.cart_id = ca.id)
      and not exists (select 1 from public.marketing_events e where e.dedupe_key = 'cart.abandoned:' || ca.id::text)
    limit 500
  loop
    perform private.emit_marketing_event('cart.abandoned', 'cart.abandoned:' || c.id::text, null, c.user_id, c.email, c.phone, null, null, c.id,
      jsonb_build_object('subtotal_minor', c.subtotal, 'item_count', c.items, 'last_activity_at', c.updated_at));
    n := n + 1;
  end loop;
  if extract(isodow from now()) = 1 and not exists (select 1 from public.marketing_events where dedupe_key = 'summary.weekly:' || v_week) then
    perform private.emit_marketing_event('summary.weekly', 'summary.weekly:' || v_week, null, null, null, null, null, null, null,
      (select jsonb_build_object('week', v_week,
         'orders', count(*), 'revenue_minor', coalesce(sum(total_minor) filter (where fulfillment_status <> 'cancelled'), 0),
         'cancelled', count(*) filter (where fulfillment_status = 'cancelled'),
         'cod_share_pct', case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where payment_method = 'cod') / count(*)) end)
       from public.orders where placed_at >= now() - interval '7 days'));
    n := n + 1;
  end if;
  return n;
end;
$$;
revoke all on function private.emit_scheduled_marketing_events() from public;
select cron.schedule('marketing-scheduled-events', '*/30 * * * *', 'select private.emit_scheduled_marketing_events()');

-- -----------------------------------------------------------------------------
-- Automation rules (data, not code)
-- -----------------------------------------------------------------------------
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  trigger_type text not null check (trigger_type in (
    'order.placed', 'payment.verified', 'cod.awaiting_verification', 'order.packed', 'order.delivered',
    'delivery.failed', 'return.requested', 'cart.abandoned', 'stock.low', 'stock.back_in_stock',
    'customer.signup', 'tryon.completed', 'tryon.failed', 'summary.weekly')),
  conditions jsonb not null default '[]'::jsonb,
  action jsonb not null,
  is_active boolean not null default false,
  mode text not null default 'dry_run' check (mode in ('dry_run', 'live')),
  quota_per_hour integer not null default 100 check (quota_per_hour between 1 and 10000),
  version integer not null default 1 check (version >= 1),
  owner_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_triggered_at timestamptz
);
create index automation_rules_trigger_idx on public.automation_rules(trigger_type) where is_active;

create table public.automation_rule_versions (
  id bigint generated always as identity primary key,
  rule_id uuid not null,
  version integer not null,
  snapshot jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  unique (rule_id, version)
);
create trigger automation_rule_versions_append_only before update or delete on public.automation_rule_versions
  for each row execute function private.forbid_mutation();

create table public.automation_executions (
  id bigint generated always as identity primary key,
  rule_id uuid not null,
  rule_version integer not null,
  event_id bigint not null,
  status text not null check (status in ('dry_run', 'queued', 'skipped')),
  reason text check (reason is null or char_length(reason) <= 200),
  outbox_id uuid,
  recipient_masked text,
  created_at timestamptz not null default now(),
  unique (rule_id, event_id)
);
create index automation_executions_rule_idx on public.automation_executions(rule_id, created_at desc);
create trigger automation_executions_append_only before update or delete on public.automation_executions
  for each row execute function private.forbid_mutation();

alter table public.automation_rules enable row level security;
alter table public.automation_rule_versions enable row level security;
alter table public.automation_executions enable row level security;
grant select, insert, update, delete on public.automation_rules to authenticated;
grant select on public.automation_rule_versions, public.automation_executions to authenticated;
create policy "automation read rules" on public.automation_rules
  for select to authenticated using ((select private.has_permission('automation.manage')) or (select private.has_permission('marketing.read')));
create policy "automation write rules" on public.automation_rules
  for all to authenticated using ((select private.has_permission('automation.manage'))) with check ((select private.has_permission('automation.manage')));
create policy "automation read versions" on public.automation_rule_versions
  for select to authenticated using ((select private.has_permission('automation.manage')));
create policy "automation read executions" on public.automation_executions
  for select to authenticated using ((select private.has_permission('automation.manage')) or (select private.has_permission('marketing.read')));

-- Webhook host allowlist lives in site_settings (edited by settings.manage / automation.manage).
insert into public.site_settings (key, value, is_public) values
  ('automation.webhook_allowlist', '{"hosts": []}'::jsonb, false),
  ('marketing.banner', '{"enabled": false, "text": "", "href": "", "starts_at": null, "ends_at": null}'::jsonb, true)
on conflict (key) do nothing;

create or replace function private.webhook_host_allowed(p_url text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text;
  v_hosts jsonb;
begin
  if p_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^\s]*)?$' then
    return false;
  end if;
  v_host := lower(substring(p_url from '^https://([A-Za-z0-9.-]+)'));
  if v_host ~ '^[0-9.]+$' or v_host in ('localhost', 'metadata.google.internal') or v_host like '%.local' or v_host like '%.internal' then
    return false;
  end if;
  select value -> 'hosts' into v_hosts from public.site_settings where key = 'automation.webhook_allowlist';
  return exists (select 1 from jsonb_array_elements_text(coalesce(v_hosts, '[]'::jsonb)) h where lower(h) = v_host);
end;
$$;
revoke all on function private.webhook_host_allowed(text) from public;

create or replace function private.validate_automation_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  v_type text := new.action ->> 'type';
  v_class text := coalesce(new.action ->> 'message_class', 'transactional');
begin
  if jsonb_typeof(new.conditions) <> 'array' or jsonb_array_length(new.conditions) > 20 then
    raise exception 'conditions must be a list of at most 20 items' using errcode = '22023';
  end if;
  for c in select * from jsonb_array_elements(new.conditions) loop
    if jsonb_typeof(c) <> 'object' or coalesce(c ->> 'field', '') !~ '^[a-z0-9_.]{1,60}$'
       or coalesce(c ->> 'op', '') not in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'exists', 'not_exists')
       or ((c ->> 'op') not in ('exists', 'not_exists') and not (c ? 'value')) then
      raise exception 'invalid condition' using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(new.action) <> 'object' or v_type not in ('email', 'sms', 'whatsapp', 'internal_alert', 'review_task', 'notify_inventory', 'webhook') then
    raise exception 'invalid action type' using errcode = '22023';
  end if;
  if v_class not in ('transactional', 'marketing') then
    raise exception 'invalid message class' using errcode = '22023';
  end if;
  if v_type = 'email' then
    if not exists (select 1 from public.email_templates where key = new.action ->> 'template_key') then
      raise exception 'unknown email template' using errcode = '22023';
    end if;
    if coalesce(new.action ->> 'to', 'customer') not in ('customer', 'staff') then
      raise exception 'email target must be customer or staff' using errcode = '22023';
    end if;
    if (new.action ->> 'to') = 'staff' and coalesce(new.action ->> 'staff_email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'staff email required' using errcode = '22023';
    end if;
  elsif v_type = 'sms' then
    if not exists (select 1 from public.sms_templates where key = new.action ->> 'template_key') then
      raise exception 'unknown sms template' using errcode = '22023';
    end if;
  elsif v_type = 'whatsapp' then
    if not exists (select 1 from public.whatsapp_templates where key = new.action ->> 'template_key') then
      raise exception 'unknown whatsapp template' using errcode = '22023';
    end if;
  elsif v_type = 'webhook' then
    if not private.webhook_host_allowed(new.action ->> 'url') then
      raise exception 'webhook host is not on the allowlist' using errcode = '22023', hint = 'webhook_host_denied';
    end if;
  elsif v_type in ('internal_alert', 'review_task', 'notify_inventory') then
    if char_length(coalesce(new.action ->> 'title', '')) not between 2 and 160 then
      raise exception 'alert title required' using errcode = '22023';
    end if;
  end if;
  if new.trigger_type in ('stock.low', 'stock.back_in_stock', 'summary.weekly') and v_type in ('email', 'sms', 'whatsapp')
     and coalesce(new.action ->> 'to', 'customer') = 'customer' then
    raise exception 'this trigger has no customer; send to staff instead' using errcode = '22023';
  end if;
  if new.trigger_type = 'stock.back_in_stock' and v_type in ('sms', 'whatsapp') then
    raise exception 'back-in-stock has no customer recipient' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if new.conditions <> old.conditions or new.action <> old.action or new.trigger_type <> old.trigger_type
       or new.mode <> old.mode or new.quota_per_hour <> old.quota_per_hour or new.is_active <> old.is_active then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_automation_rule() from public;
create trigger automation_rules_validate before insert or update on public.automation_rules
  for each row execute function private.validate_automation_rule();

create or replace function private.snapshot_automation_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.automation_rule_versions (rule_id, version, snapshot, changed_by)
  values (new.id, new.version, to_jsonb(new) - 'last_triggered_at' - 'updated_at', (select auth.uid()))
  on conflict (rule_id, version) do nothing;
  return new;
end;
$$;
revoke all on function private.snapshot_automation_rule() from public;
create trigger automation_rules_snapshot after insert or update on public.automation_rules
  for each row execute function private.snapshot_automation_rule();
create trigger automation_rules_updated_at before update on public.automation_rules
  for each row execute function private.set_updated_at();
create trigger automation_rules_audit after insert or update or delete on public.automation_rules
  for each row execute function private.audit_row_change();

-- Conditions are evaluated against the event's top-level columns plus payload keys.
create or replace function private.automation_event_json(e public.marketing_events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select e.payload || jsonb_build_object('event_type', e.event_type, 'email', e.email, 'phone', e.phone, 'user_id', e.user_id,
    'order_id', e.order_id, 'variant_id', e.variant_id, 'product_id', e.product_id, 'has_email', e.email is not null,
    'has_phone', e.phone is not null, 'is_customer', e.user_id is not null);
$$;
revoke all on function private.automation_event_json(public.marketing_events) from public;

create or replace function private.automation_conditions_match(p_conditions jsonb, p_event jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  c jsonb;
  v_actual jsonb;
  v_expected jsonb;
  v_op text;
  v_ok boolean;
begin
  for c in select * from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) loop
    v_actual := p_event -> (c ->> 'field');
    v_expected := c -> 'value';
    v_op := c ->> 'op';
    v_ok := case v_op
      when 'exists' then v_actual is not null and v_actual <> 'null'::jsonb
      when 'not_exists' then v_actual is null or v_actual = 'null'::jsonb
      when 'eq' then v_actual is not null and (v_actual = v_expected or (jsonb_typeof(v_actual) = 'string' and jsonb_typeof(v_expected) = 'string' and lower(v_actual #>> '{}') = lower(v_expected #>> '{}')))
      when 'neq' then v_actual is null or v_actual <> v_expected
      when 'gt' then jsonb_typeof(v_actual) = 'number' and jsonb_typeof(v_expected) = 'number' and (v_actual #>> '{}')::numeric > (v_expected #>> '{}')::numeric
      when 'gte' then jsonb_typeof(v_actual) = 'number' and jsonb_typeof(v_expected) = 'number' and (v_actual #>> '{}')::numeric >= (v_expected #>> '{}')::numeric
      when 'lt' then jsonb_typeof(v_actual) = 'number' and jsonb_typeof(v_expected) = 'number' and (v_actual #>> '{}')::numeric < (v_expected #>> '{}')::numeric
      when 'lte' then jsonb_typeof(v_actual) = 'number' and jsonb_typeof(v_expected) = 'number' and (v_actual #>> '{}')::numeric <= (v_expected #>> '{}')::numeric
      when 'in' then jsonb_typeof(v_expected) = 'array' and v_actual is not null and v_expected @> jsonb_build_array(v_actual)
      when 'contains' then jsonb_typeof(v_actual) = 'string' and jsonb_typeof(v_expected) = 'string' and position(lower(v_expected #>> '{}') in lower(v_actual #>> '{}')) > 0
      else false end;
    if not coalesce(v_ok, false) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.automation_conditions_match(jsonb, jsonb) from public;

create or replace function private.mask_recipient(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null then null
              when p like '%@%' then left(p, 2) || '***@' || split_part(p, '@', 2)
              when p like '+%' then left(p, 6) || '*****' || right(p, 2)
              else left(p, 12) end;
$$;
revoke all on function private.mask_recipient(text) from public;

-- Decide and enqueue for one rule + one event. Returns the execution row.
create or replace function private.automation_apply(r public.automation_rules, e public.marketing_events)
returns public.automation_executions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_type text := r.action ->> 'type';
  v_class text := coalesce(r.action ->> 'message_class', 'transactional');
  v_channel text;
  v_recipient text;
  v_used int;
  v_out public.notification_outbox;
  v_exec public.automation_executions;
  v_payload jsonb;
  v_status text;
  v_reason text;
begin
  if exists (select 1 from public.automation_executions x where x.rule_id = r.id and x.event_id = e.id) then
    select * into v_exec from public.automation_executions x where x.rule_id = r.id and x.event_id = e.id;
    return v_exec;
  end if;
  if not private.automation_conditions_match(r.conditions, private.automation_event_json(e)) then
    insert into public.automation_executions (rule_id, rule_version, event_id, status, reason)
    values (r.id, r.version, e.id, 'skipped', 'conditions_not_met') returning * into v_exec;
    return v_exec;
  end if;
  select count(*) into v_used from public.notification_outbox o where o.rule_id = r.id and o.created_at > now() - interval '1 hour';
  if v_used >= r.quota_per_hour then
    insert into public.automation_executions (rule_id, rule_version, event_id, status, reason)
    values (r.id, r.version, e.id, 'skipped', 'quota_exceeded') returning * into v_exec;
    return v_exec;
  end if;

  v_channel := case v_type when 'email' then 'email' when 'sms' then 'sms' when 'whatsapp' then 'whatsapp' when 'webhook' then 'webhook' else 'internal' end;
  v_recipient := case
    when v_type = 'email' and coalesce(r.action ->> 'to', 'customer') = 'staff' then r.action ->> 'staff_email'
    when v_type = 'email' then e.email::text
    when v_type in ('sms', 'whatsapp') then e.phone
    when v_type = 'webhook' then r.action ->> 'url'
    else null end;
  v_payload := private.automation_event_json(e) || jsonb_build_object('rule_name', r.name, 'event_id', e.id,
    'title', r.action ->> 'title', 'note', r.action ->> 'note', 'severity', coalesce(r.action ->> 'severity', 'info'),
    'event_name', coalesce(r.action ->> 'event_name', e.event_type));

  if r.mode = 'dry_run' then
    insert into public.automation_executions (rule_id, rule_version, event_id, status, reason, recipient_masked)
    values (r.id, r.version, e.id, 'dry_run', 'would send ' || v_channel, private.mask_recipient(v_recipient)) returning * into v_exec;
    return v_exec;
  end if;

  if v_type = 'webhook' and not private.webhook_host_allowed(v_recipient) then
    insert into public.automation_executions (rule_id, rule_version, event_id, status, reason, recipient_masked)
    values (r.id, r.version, e.id, 'skipped', 'webhook_host_denied', private.mask_recipient(v_recipient)) returning * into v_exec;
    return v_exec;
  end if;
  if v_type = 'review_task' and e.order_id is not null then
    update public.orders set risk_review_status = 'needs_review' where id = e.order_id and risk_review_status = 'not_required';
    if found then
      insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible, reason)
      values (e.order_id, 'risk_review_status', 'not_required', 'needs_review', 'system', false, left('Automation rule: ' || r.name, 500));
    end if;
  end if;

  v_out := private.outbox_enqueue(v_channel, case when v_channel = 'internal' then 'internal' else v_class end, v_recipient, e.user_id,
    r.action ->> 'template_key', v_payload, 'rule:' || r.id::text || ':event:' || e.id::text, r.id, e.id, null);
  if v_out.id is null then
    v_status := 'skipped'; v_reason := 'duplicate';
  elsif v_out.status = 'suppressed' then
    v_status := 'skipped'; v_reason := 'suppressed:' || coalesce(v_out.suppressed_reason, '');
  else
    v_status := 'queued'; v_reason := null;
  end if;
  insert into public.automation_executions (rule_id, rule_version, event_id, status, reason, outbox_id, recipient_masked)
  values (r.id, r.version, e.id, v_status, v_reason, v_out.id, private.mask_recipient(v_recipient)) returning * into v_exec;
  update public.automation_rules set last_triggered_at = now() where id = r.id;
  return v_exec;
end;
$$;
revoke all on function private.automation_apply(public.automation_rules, public.marketing_events) from public;

-- Worker entry point (service_role): process unprocessed events against active rules.
create or replace function public.automation_process_events(p_limit int default 100)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.marketing_events;
  r public.automation_rules;
  n int := 0;
begin
  for e in select * from public.marketing_events where processed_at is null order by id limit least(greatest(p_limit, 1), 500) for update skip locked loop
    for r in select * from public.automation_rules where is_active and trigger_type = e.event_type order by created_at, id loop
      perform private.automation_apply(r, e);
    end loop;
    update public.marketing_events set processed_at = now() where id = e.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.automation_process_events(int) from public;
grant execute on function public.automation_process_events(int) to service_role;

-- Staff: test a rule against recent events of its trigger without writing anything.
create or replace function public.automation_test_rule(p_rule_id uuid, p_limit int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.automation_rules;
begin
  if not private.has_permission('automation.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into r from public.automation_rules where id = p_rule_id;
  if not found then
    raise exception 'rule not found' using errcode = 'P0002';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('event_id', e.id, 'occurred_at', e.occurred_at,
      'matches', private.automation_conditions_match(r.conditions, private.automation_event_json(e)),
      'recipient', private.mask_recipient(case when r.action ->> 'type' = 'email' and coalesce(r.action ->> 'to', 'customer') = 'staff' then r.action ->> 'staff_email'
                                              when r.action ->> 'type' = 'email' then e.email::text
                                              when r.action ->> 'type' in ('sms', 'whatsapp') then e.phone
                                              when r.action ->> 'type' = 'webhook' then r.action ->> 'url' end),
      'marketing_allowed', case when coalesce(r.action ->> 'message_class', 'transactional') = 'marketing' and r.action ->> 'type' in ('email', 'sms', 'whatsapp')
          then private.marketing_allowed(r.action ->> 'type', case when r.action ->> 'type' = 'email' then e.email::text else e.phone end, e.user_id) end,
      'summary', e.payload - 'customer_name') order by e.id desc)
    from (select * from public.marketing_events where event_type = r.trigger_type order by id desc limit least(greatest(p_limit, 1), 50)) e), '[]'::jsonb);
end;
$$;
revoke all on function public.automation_test_rule(uuid, int) from public;
grant execute on function public.automation_test_rule(uuid, int) to authenticated;

-- -----------------------------------------------------------------------------
-- Outbox worker RPCs (service_role) and staff retry
-- -----------------------------------------------------------------------------
create or replace function public.outbox_claim(p_limit int default 20)
returns setof public.notification_outbox
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select id from public.notification_outbox
    where status = 'queued' and next_attempt_at <= now()
    order by next_attempt_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked)
  update public.notification_outbox o set status = 'sending', attempts = o.attempts + 1
  from due where o.id = due.id
  returning o.*;
end;
$$;
revoke all on function public.outbox_claim(int) from public;
grant execute on function public.outbox_claim(int) to service_role;

-- p_preview: the rendered text (staff-only visibility in the outbox view; useful for mock sends).
create or replace function public.outbox_mark_sent(p_id uuid, p_provider text, p_provider_message_id text default null, p_preview text default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.notification_outbox
     set status = 'sent', provider = left(p_provider, 40), provider_message_id = left(p_provider_message_id, 200), sent_at = now(), last_error = null,
         payload = case when p_preview is null then payload else payload || jsonb_build_object('preview', left(p_preview, 4000)) end
   where id = p_id and status = 'sending';
$$;
revoke all on function public.outbox_mark_sent(uuid, text, text, text) from public;
grant execute on function public.outbox_mark_sent(uuid, text, text, text) to service_role;

create or replace function public.outbox_mark_failed(p_id uuid, p_error text, p_retryable boolean default true, p_provider text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.notification_outbox;
  v_status text;
begin
  select * into o from public.notification_outbox where id = p_id for update;
  if not found or o.status <> 'sending' then
    return null;
  end if;
  v_status := case when p_retryable and o.attempts < o.max_attempts then 'queued' else 'dead' end;
  update public.notification_outbox
     set status = v_status, last_error = left(p_error, 500), provider = coalesce(left(p_provider, 40), provider),
         next_attempt_at = now() + (interval '1 minute' * power(2, least(o.attempts, 8)))
   where id = p_id;
  return v_status;
end;
$$;
revoke all on function public.outbox_mark_failed(uuid, text, boolean, text) from public;
grant execute on function public.outbox_mark_failed(uuid, text, boolean, text) to service_role;

create or replace function public.outbox_log_webhook(p_outbox_id uuid, p_url_host text, p_attempt int, p_status_code int, p_ok boolean, p_excerpt text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.webhook_events (outbox_id, url_host, attempt, status_code, ok, response_excerpt)
  values (p_outbox_id, left(p_url_host, 200), p_attempt, p_status_code, p_ok, left(p_excerpt, 300));
$$;
revoke all on function public.outbox_log_webhook(uuid, text, int, int, boolean, text) from public;
grant execute on function public.outbox_log_webhook(uuid, text, int, int, boolean, text) to service_role;

-- Requeue a dead/failed message. Suppressed messages cannot be forced through.
create or replace function public.admin_outbox_retry(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.notification_outbox;
begin
  if not private.has_permission('automation.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into o from public.notification_outbox where id = p_id for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if o.status not in ('dead', 'failed') then
    raise exception 'only dead or failed messages can be retried' using errcode = 'P0001';
  end if;
  update public.notification_outbox set status = 'queued', next_attempt_at = now(), attempts = 0, last_error = null where id = p_id;
  perform private.write_audit('outbox.retry', 'notification_outbox', p_id::text, to_jsonb(o) - 'payload', null, null);
  return 'queued';
end;
$$;
revoke all on function public.admin_outbox_retry(uuid) from public;
grant execute on function public.admin_outbox_retry(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Segments and campaigns
-- -----------------------------------------------------------------------------
create table public.customer_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  definition jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger customer_segments_updated_at before update on public.customer_segments for each row execute function private.set_updated_at();
create trigger customer_segments_audit after insert or update or delete on public.customer_segments for each row execute function private.audit_row_change();
alter table public.customer_segments enable row level security;
grant select, insert, update, delete on public.customer_segments to authenticated;
create policy "marketing read segments" on public.customer_segments for select to authenticated using ((select private.has_permission('marketing.read')));
create policy "marketing write segments" on public.customer_segments for all to authenticated using ((select private.has_permission('marketing.manage'))) with check ((select private.has_permission('marketing.manage')));

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  channel text not null check (channel in ('email', 'sms')),
  segment_id uuid references public.customer_segments(id) on delete restrict,
  template_key text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_at timestamptz,
  utm jsonb not null default '{}'::jsonb,
  sent_count integer not null default 0,
  suppressed_count integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create trigger campaigns_updated_at before update on public.campaigns for each row execute function private.set_updated_at();
create trigger campaigns_audit after insert or update or delete on public.campaigns for each row execute function private.audit_row_change();
alter table public.campaigns enable row level security;
grant select, insert, update, delete on public.campaigns to authenticated;
create policy "marketing read campaigns" on public.campaigns for select to authenticated using ((select private.has_permission('marketing.read')));
create policy "marketing write campaigns" on public.campaigns for all to authenticated using ((select private.has_permission('marketing.manage'))) with check ((select private.has_permission('marketing.manage')));

-- Members of a segment: (identifier, user_id). Only people who can lawfully be messaged.
create or replace function private.segment_members(p_definition jsonb, p_channel text)
returns table (recipient text, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select u.email::text as email, pr.phone, pr.id as user_id,
           (select count(*) from public.orders o where o.user_id = pr.id and o.fulfillment_status <> 'cancelled') as orders,
           (select max(o.placed_at) from public.orders o where o.user_id = pr.id) as last_order_at
    from public.profiles pr join auth.users u on u.id = pr.id
    where pr.marketing_opt_in and not pr.is_disabled
    union
    select n.email::text, null, n.user_id, 0, null
    from public.newsletter_subscriptions n
    where n.status = 'subscribed' and p_channel = 'email'
      and not exists (select 1 from public.profiles pr where pr.id = n.user_id))
  select distinct on (coalesce(case when p_channel = 'email' then email else phone end, ''))
         case when p_channel = 'email' then email else phone end as recipient, user_id
  from base
  where (case when p_channel = 'email' then email else phone end) is not null
    and (not coalesce((p_definition ->> 'has_ordered')::boolean, false) or orders > 0)
    and orders >= coalesce((p_definition ->> 'min_orders')::int, 0)
    and (p_definition ->> 'last_order_days' is null or last_order_at >= now() - ((p_definition ->> 'last_order_days')::int * interval '1 day'))
  order by coalesce(case when p_channel = 'email' then email else phone end, ''), user_id nulls last;
$$;
revoke all on function private.segment_members(jsonb, text) from public;

create or replace function public.admin_segment_count(p_definition jsonb, p_channel text)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('marketing.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (select count(*) from private.segment_members(p_definition, p_channel));
end;
$$;
revoke all on function public.admin_segment_count(jsonb, text) from public;
grant execute on function public.admin_segment_count(jsonb, text) to authenticated;

-- Send: queues one outbox row per member; de-duplicated per campaign + recipient.
create or replace function public.admin_campaign_send(p_campaign_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
  s public.customer_segments;
  m record;
  v_out public.notification_outbox;
  v_sent int := 0;
  v_supp int := 0;
  v_class text;
begin
  if not private.has_permission('marketing.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into c from public.campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  if c.status not in ('draft', 'scheduled') then
    raise exception 'campaign already sent' using errcode = 'P0001';
  end if;
  if c.channel = 'email' then
    select message_class into v_class from public.email_templates where key = c.template_key;
  else
    select message_class into v_class from public.sms_templates where key = c.template_key;
  end if;
  if v_class is null then
    raise exception 'template not found' using errcode = '22023';
  end if;
  select * into s from public.customer_segments where id = c.segment_id;
  for m in select * from private.segment_members(coalesce(s.definition, '{}'::jsonb), c.channel) loop
    v_out := private.outbox_enqueue(c.channel, 'marketing', m.recipient, m.user_id, c.template_key,
      jsonb_build_object('campaign_id', c.id, 'campaign_name', c.name, 'utm', c.utm),
      'campaign:' || c.id::text || ':' || lower(m.recipient), null, null, c.id);
    if v_out.id is null then continue; end if;
    if v_out.status = 'suppressed' then v_supp := v_supp + 1; else v_sent := v_sent + 1; end if;
  end loop;
  update public.campaigns set status = 'sent', sent_at = now(), sent_count = v_sent, suppressed_count = v_supp where id = c.id;
  perform private.write_audit('campaign.send', 'campaigns', c.id::text, null, jsonb_build_object('queued', v_sent, 'suppressed', v_supp), null);
  return jsonb_build_object('queued', v_sent, 'suppressed', v_supp);
end;
$$;
revoke all on function public.admin_campaign_send(uuid) from public;
grant execute on function public.admin_campaign_send(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Integration connections: metadata + the NAME of the environment secret only.
-- -----------------------------------------------------------------------------
create table public.integration_connections (
  provider text primary key check (provider in ('smtp', 'sms', 'whatsapp', 'meta_pixel', 'ga4', 'webhook_signing')),
  status text not null default 'not_configured' check (status in ('not_configured', 'configured', 'disabled')),
  public_config jsonb not null default '{}'::jsonb,
  secret_env text check (secret_env is null or secret_env ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  notes text check (notes is null or char_length(notes) <= 500),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger integration_connections_updated_at before update on public.integration_connections for each row execute function private.set_updated_at();
create or replace function private.integration_connections_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v text;
begin
  -- Nothing secret-shaped may be stored here.
  for v in select value from jsonb_each_text(new.public_config) loop
    if v ~* '(^|[^a-z])(sk|secret|token|password|passwd|pwd)([^a-z]|$)' or v ~ '^(sb_secret_|eyJ|AKIA|xox[bp]-)' or char_length(v) > 300 then
      raise exception 'public_config may not hold secrets' using errcode = '22023';
    end if;
  end loop;
  perform private.write_audit(lower(tg_op), 'integration_connections', new.provider, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), null);
  return new;
end;
$$;
revoke all on function private.integration_connections_guard() from public;
create trigger integration_connections_guard before insert or update on public.integration_connections
  for each row execute function private.integration_connections_guard();
alter table public.integration_connections enable row level security;
grant select, update on public.integration_connections to authenticated;
create policy "integrations read" on public.integration_connections
  for select to authenticated using ((select private.has_permission('integrations.read')) or (select private.has_permission('marketing.read')));
create policy "integrations manage" on public.integration_connections
  for update to authenticated using ((select private.has_permission('integrations.manage'))) with check ((select private.has_permission('integrations.manage')));
insert into public.integration_connections (provider, secret_env, notes) values
  ('smtp', 'SMTP_URL', 'Transactional and marketing email. Without it, email messages are dead-lettered in production.'),
  ('sms', 'SMS_API_KEY', 'Bangladesh SMS gateway (adapter stub).'),
  ('whatsapp', 'WHATSAPP_ACCESS_TOKEN', 'WhatsApp Business template messages (adapter stub).'),
  ('meta_pixel', 'META_CAPI_TOKEN', 'Pixel id in public_config.pixel_id; CAPI token in the environment.'),
  ('ga4', null, 'Measurement id in public_config.measurement_id. Loaded only with analytics consent.'),
  ('webhook_signing', 'WEBHOOK_SIGNING_SECRET', 'HMAC-SHA256 key for outbound webhooks.')
on conflict (provider) do nothing;

-- Marketing banner + webhook allowlist editors (audited).
create or replace function public.admin_update_marketing_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  h text;
begin
  if p_key = 'marketing.banner' then
    if not private.has_permission('marketing.manage') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    if char_length(coalesce(p_value ->> 'text', '')) > 200 or coalesce(p_value ->> 'href', '') !~ '^(|/[^\s]*)$' or char_length(coalesce(p_value ->> 'href', '')) > 300 then
      raise exception 'banner text must be at most 200 characters and the link a site path' using errcode = '22023';
    end if;
  elsif p_key = 'automation.webhook_allowlist' then
    if not private.has_permission('automation.manage') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    if jsonb_typeof(p_value -> 'hosts') <> 'array' or jsonb_array_length(p_value -> 'hosts') > 50 then
      raise exception 'hosts must be a list' using errcode = '22023';
    end if;
    for h in select * from jsonb_array_elements_text(p_value -> 'hosts') loop
      if h !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or h ~ '\.(local|internal|localhost)$' then
        raise exception 'invalid host: %', h using errcode = '22023';
      end if;
    end loop;
  else
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  select value into v_old from public.site_settings where key = p_key;
  insert into public.site_settings (key, value, is_public) values (p_key, p_value, p_key = 'marketing.banner')
  on conflict (key) do update set value = excluded.value;
  perform private.write_audit(p_key, 'site_settings', p_key, v_old, p_value, null);
  return p_value;
end;
$$;
revoke all on function public.admin_update_marketing_setting(text, jsonb) from public;
grant execute on function public.admin_update_marketing_setting(text, jsonb) to authenticated;

-- Marketing overview numbers for the admin (no personal data).
create or replace function public.marketing_admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('marketing.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'coupons_active', (select count(*) from public.promotions where kind = 'coupon' and is_active),
    'automatic_active', (select count(*) from public.promotions where kind = 'automatic' and is_active),
    'redemptions_30d', (select count(*) from public.coupon_redemptions where created_at > now() - interval '30 days'),
    'discount_30d_minor', (select coalesce(sum(discount_minor), 0) from public.coupon_redemptions where created_at > now() - interval '30 days'),
    'newsletter', (select jsonb_build_object('subscribed', count(*) filter (where status = 'subscribed'),
        'pending', count(*) filter (where status = 'pending'), 'unsubscribed', count(*) filter (where status = 'unsubscribed')) from public.newsletter_subscriptions),
    'opted_in_accounts', (select count(*) from public.profiles where marketing_opt_in),
    'suppressed', (select count(*) from public.unsubscribes),
    'rules', (select jsonb_build_object('active', count(*) filter (where is_active), 'dry_run', count(*) filter (where is_active and mode = 'dry_run'), 'total', count(*)) from public.automation_rules),
    'events_unprocessed', (select count(*) from public.marketing_events where processed_at is null),
    'events_24h', (select count(*) from public.marketing_events where occurred_at > now() - interval '24 hours'),
    'outbox', (select jsonb_object_agg(status, n) from (select status, count(*) as n from public.notification_outbox where created_at > now() - interval '7 days' group by status) s),
    'attribution_30d', (select jsonb_build_object(
        'orders', count(*),
        'attributed', count(*) filter (where exists (select 1 from public.attribution_events a where a.order_id = o.id)),
        'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', coalesce(a.utm_source, '(none)'), 'orders', a.n) order by a.n desc), '[]'::jsonb)
                      from (select utm_source, count(*) as n from public.attribution_events a join public.orders o2 on o2.id = a.order_id
                            where o2.placed_at > now() - interval '30 days' group by utm_source limit 10) a))
      from public.orders o where o.placed_at > now() - interval '30 days'));
end;
$$;
revoke all on function public.marketing_admin_stats() from public;
grant execute on function public.marketing_admin_stats() to authenticated;

-- Public: active banner (is_public settings are readable through site_settings' existing policy).

-- -----------------------------------------------------------------------------
-- Seed reference templates (editable by marketing.manage)
-- -----------------------------------------------------------------------------
insert into public.email_templates (key, name, subject, body_text, message_class) values
  ('order_confirmation', 'Order confirmation', 'Your order {{order_number}} is confirmed',
   'Hi {{customer_name}},\n\nThanks for your order {{order_number}}. We will let you know when it ships.\n\nTotal: {{total}}\nPayment: {{payment_method}}\n\n{{store_name}}', 'transactional'),
  ('payment_received', 'Payment received', 'Payment received for {{order_number}}',
   'Hi {{customer_name}},\n\nWe received your payment for order {{order_number}}. Total: {{total}}.\n\n{{store_name}}', 'transactional'),
  ('order_packed', 'Order packed', 'Your order {{order_number}} is packed',
   'Hi {{customer_name}},\n\nOrder {{order_number}} is packed and will be handed to the courier shortly.\n\n{{store_name}}', 'transactional'),
  ('order_delivered', 'Order delivered', 'Order {{order_number}} delivered',
   'Hi {{customer_name}},\n\nOrder {{order_number}} was delivered. We hope you love it.\n\n{{store_name}}', 'transactional'),
  ('newsletter_confirm', 'Newsletter confirmation', 'Please confirm your subscription',
   'Confirm your subscription to {{store_name}} by opening this link:\n\n{{confirm_url}}\n\nIf you did not ask for this, ignore this email.', 'transactional'),
  ('abandoned_cart', 'Abandoned cart reminder', 'You left something behind',
   'Hi,\n\nYour cart at {{store_name}} is waiting ({{item_count}} items). Come back when you are ready.\n\nUnsubscribe: {{unsubscribe_url}}', 'marketing'),
  ('staff_alert', 'Staff alert', '[{{store_name}}] {{title}}',
   '{{title}}\n\nEvent: {{event_type}}\n{{note}}', 'transactional')
on conflict (key) do nothing;
insert into public.sms_templates (key, name, body_text, message_class) values
  ('order_confirmation_sms', 'Order confirmation (SMS)', '{{store_name}}: order {{order_number}} confirmed. Total {{total}}.', 'transactional'),
  ('order_delivered_sms', 'Delivered (SMS)', '{{store_name}}: order {{order_number}} delivered. Thank you!', 'transactional')
on conflict (key) do nothing;
insert into public.whatsapp_templates (key, name, provider_template_name, language_code, variables, message_class) values
  ('order_update_wa', 'Order update (WhatsApp)', 'order_update', 'en', '{order_number,status}', 'transactional')
on conflict (key) do nothing;
