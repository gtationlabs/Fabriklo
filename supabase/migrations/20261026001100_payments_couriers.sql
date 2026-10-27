-- =============================================================================
-- Fabriklo 0011: online payments (provider-agnostic; SSLCOMMERZ first) and
-- courier events. Rules: the browser is never trusted; an order becomes 'paid'
-- only via private.settle_payment after SERVER-SIDE validation; every gateway
-- message is logged and de-duplicated; unpaid orders release their stock hold.
-- =============================================================================

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null check (provider in ('sslcommerz', 'mock')),
  tran_id text not null unique check (tran_id ~ '^FBK-[0-9]{6,10}-[0-9]{1,3}$'),
  attempt int not null check (attempt between 1 and 999),
  status text not null default 'initiated' check (status in ('initiated', 'redirected', 'valid', 'failed', 'cancelled', 'expired')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'BDT' check (currency = 'BDT'),
  session_key text,
  gateway_val_id text unique,
  bank_tran_id text,
  card_type text,
  gateway_risk_level text,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, attempt)
);
create index payment_transactions_order_idx on public.payment_transactions(order_id);
create trigger payment_transactions_updated_at before update on public.payment_transactions
  for each row execute function private.set_updated_at();

-- Every message from a gateway (IPN, redirect, validation call), append-only.
create table public.payment_events (
  id bigint generated always as identity primary key,
  transaction_id uuid references public.payment_transactions(id) on delete restrict,
  provider text not null,
  kind text not null check (kind in ('session_created', 'ipn', 'return', 'validation', 'settled', 'rejected', 'expired')),
  dedupe_key text unique,
  status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index payment_events_tx_idx on public.payment_events(transaction_id);
create trigger payment_events_append_only before update or delete on public.payment_events
  for each row execute function private.forbid_mutation();

alter table public.payment_transactions enable row level security;
alter table public.payment_events enable row level security;
grant select on public.payment_transactions, public.payment_events to authenticated;
create policy "staff read payment transactions" on public.payment_transactions
  for select to authenticated using ((select private.has_permission('orders.read')));
create policy "staff read payment events" on public.payment_events
  for select to authenticated using ((select private.has_permission('orders.read')));
create policy "customers read own payment transactions" on public.payment_transactions
  for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- create_order: add the online path (stock HOLD until paid).
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
  v_online jsonb;
  v_hold_minutes int;
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
  if p_payment_method = 'cod' and not (v_quote ->> 'cod_available')::boolean then
    raise exception 'cash on delivery is not available for this order' using errcode = 'P0001', hint = 'cod_unavailable';
  end if;
  if p_payment_method = 'sslcommerz' and (v_quote ->> 'total_minor')::bigint < 1000 then
    raise exception 'online payment needs a total of at least 10 taka' using errcode = 'P0001', hint = 'payment_unavailable';
  end if;

  insert into public.orders (user_id, cart_id, idempotency_key, customer_name, customer_phone, customer_email,
      shipping_address, subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor,
      payment_method, payment_status, customer_note, is_demo)
  values ((select auth.uid()), v_cart.id, p_idempotency_key, v_name, v_phone, v_email,
      jsonb_build_object('recipient_name', v_name, 'phone', v_phone, 'division', v_division, 'district', v_district,
                         'area', v_area, 'address_line', v_line, 'postal_code', v_postal,
                         'zone', v_quote -> 'zone'),
      (v_quote ->> 'subtotal_minor')::bigint, 0, (v_quote ->> 'shipping_minor')::bigint, 0,
      (v_quote ->> 'total_minor')::bigint, p_payment_method,
      case when p_payment_method = 'cod' then 'cod_pending' else 'awaiting_payment' end,
      nullif(btrim(coalesce(p_note, '')), ''),
      exists (select 1 from public.cart_items ci join public.product_variants v on v.id = ci.variant_id
              join public.products p on p.id = v.product_id where ci.cart_id = v_cart.id and p.is_demo))
  returning * into v_order;

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

-- -----------------------------------------------------------------------------
-- Payment attempts. Called only by the trusted server (service_role).
-- -----------------------------------------------------------------------------
create or replace function public.payment_begin(p_order_number text, p_tracking_token text, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_attempt int;
  t public.payment_transactions;
begin
  if p_provider not in ('sslcommerz', 'mock') then
    raise exception 'unknown provider' using errcode = '22023';
  end if;
  select * into o from public.orders
   where order_number = p_order_number and tracking_token_hash = extensions.digest(p_tracking_token, 'sha256')
   for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.payment_method <> 'sslcommerz' or o.payment_status <> 'awaiting_payment' or o.fulfillment_status = 'cancelled' then
    raise exception 'order is not awaiting payment' using errcode = 'P0001', hint = 'not_payable';
  end if;
  if exists (select 1 from public.payment_transactions where order_id = o.id and status = 'valid') then
    raise exception 'order already paid' using errcode = 'P0001', hint = 'already_paid';
  end if;
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.payment_transactions where order_id = o.id;
  if v_attempt > 20 then
    raise exception 'too many payment attempts' using errcode = 'P0001', hint = 'too_many_attempts';
  end if;
  insert into public.payment_transactions (order_id, provider, tran_id, attempt, amount_minor)
  values (o.id, p_provider, o.order_number || '-' || v_attempt, v_attempt, o.total_minor)
  returning * into t;
  return jsonb_build_object('transaction_id', t.id, 'tran_id', t.tran_id, 'amount_minor', t.amount_minor,
    'currency', t.currency, 'customer', jsonb_build_object('name', o.customer_name, 'phone', o.customer_phone,
    'email', o.customer_email, 'address', o.shipping_address), 'order_id', o.id);
end;
$$;
revoke all on function public.payment_begin(text, text, text) from public;
grant execute on function public.payment_begin(text, text, text) to service_role;

create or replace function public.payment_session_recorded(p_tran_id text, p_session_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_transactions set session_key = p_session_key, status = 'redirected'
   where tran_id = p_tran_id and status = 'initiated';
  insert into public.payment_events (transaction_id, provider, kind, status, payload)
  select id, provider, 'session_created', 'redirected', jsonb_build_object('session_key', p_session_key)
    from public.payment_transactions where tran_id = p_tran_id;
$$;
revoke all on function public.payment_session_recorded(text, text) from public;
grant execute on function public.payment_session_recorded(text, text) to service_role;

-- Log any gateway message. Returns false when the same message was seen before.
create or replace function public.payment_log_event(p_tran_id text, p_kind text, p_dedupe_key text, p_status text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.payment_transactions;
begin
  select * into t from public.payment_transactions where tran_id = p_tran_id;
  if p_dedupe_key is not null and exists (select 1 from public.payment_events where dedupe_key = p_dedupe_key) then
    return false;
  end if;
  insert into public.payment_events (transaction_id, provider, kind, dedupe_key, status, payload)
  values (t.id, coalesce(t.provider, 'unknown'), p_kind, p_dedupe_key, left(p_status, 40), p_payload);
  return true;
end;
$$;
revoke all on function public.payment_log_event(text, text, text, text, jsonb) from public;
grant execute on function public.payment_log_event(text, text, text, text, jsonb) to service_role;

-- The ONLY way an order becomes 'paid'. The server calls this after validating
-- with the gateway; amount/currency are re-checked here against the order.
create or replace function public.payment_settle(
  p_tran_id text, p_outcome text, p_amount_minor bigint, p_currency text,
  p_gateway_val_id text, p_bank_tran_id text, p_card_type text, p_gateway_risk text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.payment_transactions;
  o public.orders;
  r record;
  v_res public.inventory_reservations;
  v_short boolean := false;
begin
  if p_outcome not in ('valid', 'failed', 'cancelled') then
    raise exception 'invalid outcome' using errcode = '22023';
  end if;
  select * into t from public.payment_transactions where tran_id = p_tran_id for update;
  if not found then
    raise exception 'unknown transaction' using errcode = 'P0002', hint = 'unknown_transaction';
  end if;
  select * into o from public.orders where id = t.order_id for update;

  if t.status = 'valid' then
    return jsonb_build_object('order_number', o.order_number, 'status', 'valid', 'changed', false);
  end if;

  if p_outcome in ('failed', 'cancelled') then
    if t.status in ('initiated', 'redirected') then
      update public.payment_transactions set status = p_outcome where id = t.id;
      insert into public.payment_events (transaction_id, provider, kind, status, payload)
      values (t.id, t.provider, 'settled', p_outcome, p_payload);
    end if;
    return jsonb_build_object('order_number', o.order_number, 'status', p_outcome, 'changed', true);
  end if;

  -- VALID: amounts must match exactly; anything else is recorded as rejected
  -- (returned, not raised, so the rejection itself is kept in the log).
  if p_amount_minor <> t.amount_minor or p_currency <> t.currency or p_gateway_val_id is null then
    insert into public.payment_events (transaction_id, provider, kind, status, payload)
    values (t.id, t.provider, 'rejected', 'amount_mismatch',
            p_payload || jsonb_build_object('expected_minor', t.amount_minor, 'got_minor', p_amount_minor, 'got_currency', p_currency));
    return jsonb_build_object('order_number', o.order_number, 'status', 'rejected', 'reason', 'amount_mismatch', 'changed', false);
  end if;
  if exists (select 1 from public.payment_transactions where gateway_val_id = p_gateway_val_id and id <> t.id) then
    insert into public.payment_events (transaction_id, provider, kind, status, payload)
    values (t.id, t.provider, 'rejected', 'replayed_val_id', p_payload || jsonb_build_object('val_id', p_gateway_val_id));
    return jsonb_build_object('order_number', o.order_number, 'status', 'rejected', 'reason', 'replayed_val_id', 'changed', false);
  end if;

  update public.payment_transactions
     set status = 'valid', gateway_val_id = p_gateway_val_id, bank_tran_id = left(p_bank_tran_id, 80),
         card_type = left(p_card_type, 60), gateway_risk_level = left(p_gateway_risk, 10), settled_at = now()
   where id = t.id;
  insert into public.payment_events (transaction_id, provider, kind, status, payload)
  values (t.id, t.provider, 'settled', 'valid', p_payload);

  -- Take the held stock. If a hold expired meanwhile, try to reserve again.
  for r in select oi.id, oi.variant_id, oi.quantity, oi.reservation_id from public.order_items oi
            where oi.order_id = o.id order by oi.variant_id loop
    select * into v_res from public.inventory_reservations where id = r.reservation_id;
    if v_res.status = 'active' then
      perform private.close_reservation(v_res.id, 'committed');
    elsif v_res.status <> 'committed' then
      begin
        v_res := private.reserve_stock(r.variant_id, r.quantity, o.id, 'repay:' || t.id::text || ':' || r.variant_id::text, 60);
        perform private.close_reservation(v_res.id, 'committed');
      exception when others then
        v_short := true;
      end;
    end if;
  end loop;

  update public.orders set payment_status = 'paid',
         fulfillment_status = case when fulfillment_status = 'cancelled' then 'unfulfilled' else fulfillment_status end
   where id = o.id;
  insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible, reason)
  values (o.id, 'payment_status', o.payment_status, 'paid', 'gateway', true, 'Payment confirmed by ' || t.provider);

  if v_short or p_gateway_risk = '1' then
    insert into public.risk_signals (order_id, rule_code, level, explanation)
    values (o.id, 'manual_flag', 'high', case when v_short
      then 'Paid after the stock hold expired and an item is now sold out: restock or refund'
      else 'Payment gateway marked this transaction as high risk: verify before dispatch' end);
    update public.orders set risk_review_status = 'needs_review', risk_level = 'high' where id = o.id;
    insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible, reason)
    values (o.id, 'risk_review_status', o.risk_review_status, 'needs_review', 'system', false, 'Held for review after payment');
  end if;
  return jsonb_build_object('order_number', o.order_number, 'status', 'valid', 'changed', true, 'stock_short', v_short);
end;
$$;
revoke all on function public.payment_settle(text, text, bigint, text, text, text, text, text, jsonb) from public;
grant execute on function public.payment_settle(text, text, bigint, text, text, text, text, text, jsonb) to service_role;

-- Customer-facing payment state (order number + token).
create or replace function public.payment_status(p_order_number text, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('order_number', o.order_number, 'payment_method', o.payment_method,
    'payment_status', o.payment_status, 'total_minor', o.total_minor, 'fulfillment_status', o.fulfillment_status,
    'last_attempt', (select jsonb_build_object('status', t.status, 'provider', t.provider, 'at', t.updated_at)
                     from public.payment_transactions t where t.order_id = o.id order by t.attempt desc limit 1))
  from public.orders o
  where o.order_number = p_order_number and o.tracking_token_hash = extensions.digest(p_token, 'sha256');
$$;
revoke all on function public.payment_status(text, text) from public;
grant execute on function public.payment_status(text, text) to anon, authenticated;

-- Unpaid online orders: cancel after the hold plus a grace period (worker/cron).
create or replace function public.expire_unpaid_orders(p_grace_minutes int default 15)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_count int := 0;
  r record;
begin
  for o in
    select id, order_number, payment_status, fulfillment_status from public.orders
    where payment_method = 'sslcommerz' and payment_status = 'awaiting_payment' and fulfillment_status <> 'cancelled'
      and placed_at < now() - make_interval(mins => p_grace_minutes)
      and not exists (select 1 from public.inventory_reservations res where res.order_id = orders.id and res.status = 'active')
      and not exists (select 1 from public.payment_transactions tx where tx.order_id = orders.id and tx.status = 'valid')
    order by placed_at limit 500 for update skip locked
  loop
    update public.orders set payment_status = 'failed', fulfillment_status = 'cancelled' where id = o.id;
    update public.payment_transactions set status = 'expired' where order_id = o.id and status in ('initiated', 'redirected');
    for r in select id, provider from public.payment_transactions where order_id = o.id and status = 'expired' loop
      insert into public.payment_events (transaction_id, provider, kind, status) values (r.id, r.provider, 'expired', 'expired');
    end loop;
    insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible, reason)
    values (o.id, 'payment_status', 'awaiting_payment', 'failed', 'system', true, 'Payment was not completed in time'),
           (o.id, 'fulfillment_status', o.fulfillment_status, 'cancelled', 'system', true, 'Cancelled: payment not completed');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.expire_unpaid_orders(int) from public, anon, authenticated;
grant execute on function public.expire_unpaid_orders(int) to service_role;
select cron.schedule('expire-unpaid-orders', '*/5 * * * *', 'select public.expire_unpaid_orders(15)');

-- Cancelling an awaiting-payment order releases its hold instead of restocking.
create or replace function private.restock_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i record;
  v_wh uuid;
  v_res public.inventory_reservations;
begin
  for i in select oi.id, oi.variant_id, oi.quantity, oi.reservation_id
           from public.order_items oi
           where oi.order_id = p_order_id and oi.variant_id is not null
           order by oi.variant_id
  loop
    select * into v_res from public.inventory_reservations where id = i.reservation_id;
    if v_res.status = 'active' then
      perform private.close_reservation(v_res.id, 'released');
    elsif v_res.status = 'committed' or v_res.id is null then
      v_wh := coalesce(v_res.warehouse_id, (select id from public.warehouses where is_default));
      perform private.apply_stock_movement(i.variant_id, v_wh, 'restock', i.quantity, 0, p_reason,
        'order', p_order_id::text, 'restock:' || i.id::text);
    end if;
  end loop;
end;
$$;

-- Cancelling an order that is still waiting for payment voids the payment
-- (nothing was charged). Done in a trigger so every cancel path agrees.
create or replace function private.void_payment_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfillment_status = 'cancelled' and old.fulfillment_status <> 'cancelled' and new.payment_status = 'awaiting_payment' then
    new.payment_status := 'voided';
    insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible)
    values (new.id, 'payment_status', 'awaiting_payment', 'voided', 'system', false);
  end if;
  return new;
end;
$$;
revoke all on function private.void_payment_on_cancel() from public;
create trigger orders_void_payment_on_cancel before update of fulfillment_status on public.orders
  for each row execute function private.void_payment_on_cancel();

-- The state machine: 'awaiting_payment' may be voided on cancel, like COD.
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
    ('payment_status', 'paid', 'refunded'),
    ('risk_review_status', 'not_required', 'needs_review'),
    ('risk_review_status', 'needs_review', 'verified'),
    ('risk_review_status', 'needs_review', 'approved'),
    ('risk_review_status', 'verified', 'approved'),
    ('risk_review_status', 'needs_review', 'rejected_with_reason'),
    ('risk_review_status', 'verified', 'rejected_with_reason'),
    ('risk_review_status', 'needs_review', 'blocked_by_policy')
  );
$$;

-- -----------------------------------------------------------------------------
-- Courier events: verified webhooks land here (deduped) before touching orders.
-- -----------------------------------------------------------------------------
create table public.courier_events (
  id bigint generated always as identity primary key,
  courier text not null check (courier in ('manual', 'pathao', 'steadfast', 'redx', 'other')),
  event_id text not null,
  tracking_number text,
  shipment_id uuid references public.shipments(id) on delete set null,
  status text not null,
  mapped_status text,
  applied boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (courier, event_id)
);
alter table public.courier_events enable row level security;
grant select on public.courier_events to authenticated;
create policy "staff read courier events" on public.courier_events
  for select to authenticated using ((select private.has_permission('orders.read')));

-- Service-role entry point used by the verified webhook handler.
create or replace function public.courier_apply_event(
  p_courier text, p_event_id text, p_tracking_number text, p_status text, p_mapped text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  o public.orders;
  v_from text;
begin
  if exists (select 1 from public.courier_events where courier = p_courier and event_id = p_event_id) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into s from public.shipments where courier = p_courier and tracking_number = p_tracking_number;
  insert into public.courier_events (courier, event_id, tracking_number, shipment_id, status, mapped_status, payload)
  values (p_courier, p_event_id, p_tracking_number, s.id, left(p_status, 60), p_mapped, p_payload);
  if s.id is null or p_mapped is null then
    return jsonb_build_object('duplicate', false, 'applied', false);
  end if;
  select * into o from public.orders where id = s.order_id for update;
  v_from := o.shipment_status;
  if v_from = p_mapped or not private.order_transition_allowed('shipment_status', v_from, p_mapped) then
    return jsonb_build_object('duplicate', false, 'applied', false, 'from', v_from);
  end if;
  update public.orders set shipment_status = p_mapped where id = o.id;
  insert into public.order_status_events (order_id, field, from_value, to_value, actor_kind, customer_visible, reason)
  values (o.id, 'shipment_status', v_from, p_mapped, 'courier', true, 'Update from ' || p_courier);
  if p_mapped = 'handed_to_courier' and o.fulfillment_status <> 'fulfilled' then
    update public.orders set fulfillment_status = 'fulfilled' where id = o.id;
  end if;
  if p_mapped = 'returned' then
    perform private.restock_order(o.id, 'Order ' || o.order_number || ' returned to sender (courier)');
    if o.payment_status = 'cod_pending' then
      update public.orders set payment_status = 'voided' where id = o.id;
    end if;
  end if;
  update public.courier_events set applied = true where courier = p_courier and event_id = p_event_id;
  return jsonb_build_object('duplicate', false, 'applied', true, 'from', v_from, 'to', p_mapped);
end;
$$;
revoke all on function public.courier_apply_event(text, text, text, text, text, jsonb) from public;
grant execute on function public.courier_apply_event(text, text, text, text, text, jsonb) to service_role;
