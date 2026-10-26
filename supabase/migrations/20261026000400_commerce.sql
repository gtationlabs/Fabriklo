-- =============================================================================
-- Fabriklo 0004: carts (capability-token RPCs) and order schema with split states
-- Clients have NO direct table privileges on carts or orders. Guest carts are
-- reachable only by presenting a 256-bit random token (stored as SHA-256 hash),
-- which the Next.js server keeps in an httpOnly cookie.
-- =============================================================================

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'converted', 'abandoned')),
  currency text not null default 'BDT' check (currency = 'BDT'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index carts_user_idx on public.carts(user_id) where user_id is not null;
create trigger carts_updated_at before update on public.carts
  for each row execute function private.set_updated_at();

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 10),
  added_at timestamptz not null default now(),
  unique (cart_id, variant_id)
);

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
-- Intentionally no grants and no policies for anon/authenticated.

create or replace function private.cart_by_token(p_token text)
returns public.carts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select * into v_cart from public.carts
  where token_hash = extensions.digest(p_token, 'sha256')
    and status = 'active' and expires_at > now();
  return v_cart;
end;
$$;
revoke all on function private.cart_by_token(text) from public;

-- Creates a cart and returns its bearer token exactly once.
create or replace function public.cart_create()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.carts (token_hash, user_id)
  values (extensions.digest(v_token, 'sha256'), (select auth.uid()));
  return v_token;
end;
$$;

-- Server-priced cart view. Prices and availability always come from the DB.
create or replace function public.cart_get(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
  v_items jsonb;
begin
  v_cart := private.cart_by_token(p_token);
  if v_cart.id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'variant_id', v.id,
      'product_id', p.id,
      'slug', p.slug,
      'title', p.title,
      'sku', v.sku,
      'size', v.size,
      'color', v.color,
      'color_hex', v.color_hex,
      'unit_price_minor', v.price_minor,
      'quantity', ci.quantity,
      'line_total_minor', v.price_minor * ci.quantity,
      'available', coalesce(av.available, 0),
      'purchasable', (v.is_active and private.product_is_public(p.id)),
      'is_demo', p.is_demo
    ) order by ci.added_at), '[]'::jsonb)
  into v_items
  from public.cart_items ci
  join public.product_variants v on v.id = ci.variant_id
  join public.products p on p.id = v.product_id
  left join lateral public.get_variant_availability(array[v.id]) av on true
  where ci.cart_id = v_cart.id;

  return jsonb_build_object(
    'currency', v_cart.currency,
    'items', v_items,
    'item_count', (select coalesce(sum((i ->> 'quantity')::int), 0) from jsonb_array_elements(v_items) i),
    'subtotal_minor', (select coalesce(sum((i ->> 'line_total_minor')::bigint), 0)
                        from jsonb_array_elements(v_items) i where (i ->> 'purchasable')::boolean)
  );
end;
$$;

-- Set absolute quantity for a variant (0 removes). Validates visibility and stock.
create or replace function public.cart_set_item(p_token text, p_variant_id uuid, p_quantity integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
  v_available integer;
  v_lines integer;
begin
  v_cart := private.cart_by_token(p_token);
  if v_cart.id is null then
    raise exception 'cart not found' using errcode = 'P0002';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 10 then
    raise exception 'quantity must be between 0 and 10' using errcode = '22023';
  end if;

  if p_quantity = 0 then
    delete from public.cart_items where cart_id = v_cart.id and variant_id = p_variant_id;
    return public.cart_get(p_token);
  end if;

  if not exists (
    select 1 from public.product_variants v
    where v.id = p_variant_id and v.is_active and private.product_is_public(v.product_id)) then
    raise exception 'variant is not available for sale' using errcode = '22023';
  end if;

  select available into v_available from public.get_variant_availability(array[p_variant_id]);
  if coalesce(v_available, 0) < p_quantity then
    raise exception 'only % left in stock', coalesce(v_available, 0) using errcode = 'P0001', hint = 'stock_unavailable';
  end if;

  select count(*) into v_lines from public.cart_items where cart_id = v_cart.id;
  if v_lines >= 30 and not exists (select 1 from public.cart_items where cart_id = v_cart.id and variant_id = p_variant_id) then
    raise exception 'cart line limit reached' using errcode = '22023';
  end if;

  insert into public.cart_items (cart_id, variant_id, quantity)
  values (v_cart.id, p_variant_id, p_quantity)
  on conflict (cart_id, variant_id) do update set quantity = excluded.quantity;

  update public.carts set updated_at = now() where id = v_cart.id;
  return public.cart_get(p_token);
end;
$$;

revoke all on function public.cart_create() from public;
revoke all on function public.cart_get(text) from public;
revoke all on function public.cart_set_item(text, uuid, integer) from public;
grant execute on function public.cart_create() to anon, authenticated;
grant execute on function public.cart_get(text) to anon, authenticated;
grant execute on function public.cart_set_item(text, uuid, integer) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Orders: separate payment / fulfilment / shipment / risk states.
-- Order creation and state transitions are RPC-only (order slice).
-- -----------------------------------------------------------------------------
create sequence public.order_number_seq start 100001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('FBK-' || nextval('public.order_number_seq')::text),
  user_id uuid references auth.users(id) on delete set null,
  cart_id uuid references public.carts(id) on delete set null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 120),
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  customer_phone text not null check (customer_phone ~ '^\+8801[3-9][0-9]{8}$'),
  customer_email extensions.citext check (customer_email is null or customer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  shipping_address jsonb not null,
  currency text not null default 'BDT' check (currency = 'BDT'),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  shipping_minor bigint not null default 0 check (shipping_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  payment_method text not null check (payment_method in ('cod', 'sslcommerz')),
  payment_status text not null default 'unpaid' check (payment_status in (
    'unpaid', 'awaiting_payment', 'paid', 'failed', 'cod_pending', 'cod_collected', 'refunded', 'partially_refunded', 'voided')),
  fulfillment_status text not null default 'unfulfilled' check (fulfillment_status in (
    'unfulfilled', 'confirmed', 'picking', 'packed', 'partially_fulfilled', 'fulfilled', 'cancelled')),
  shipment_status text not null default 'not_shipped' check (shipment_status in (
    'not_shipped', 'ready_for_pickup', 'handed_to_courier', 'in_transit', 'out_for_delivery',
    'delivered', 'delivery_failed', 'rto', 'returned')),
  risk_review_status text not null default 'not_required' check (risk_review_status in (
    'not_required', 'needs_review', 'verified', 'approved', 'rejected_with_reason', 'blocked_by_policy')),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  tracking_token_hash bytea unique,
  customer_note text check (customer_note is null or char_length(customer_note) <= 500),
  is_demo boolean not null default false,
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_consistent check (total_minor = subtotal_minor - discount_minor + shipping_minor + tax_minor)
);
create index orders_user_idx on public.orders(user_id, placed_at desc);
create index orders_placed_idx on public.orders(placed_at desc);
create index orders_status_idx on public.orders(payment_status, fulfillment_status, shipment_status);
create index orders_risk_idx on public.orders(risk_review_status) where risk_review_status = 'needs_review';
create index orders_phone_idx on public.orders(customer_phone);
create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

alter table public.inventory_reservations
  add constraint inventory_reservations_order_fk foreign key (order_id) references public.orders(id) on delete restrict;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  variant_id uuid references public.product_variants(id) on delete set null,
  -- Immutable purchase snapshot
  product_title text not null,
  sku text not null,
  size text not null,
  color text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity between 1 and 10),
  line_total_minor bigint not null check (line_total_minor = unit_price_minor * quantity),
  reservation_id uuid references public.inventory_reservations(id),
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items(order_id);
create trigger order_items_immutable before update or delete on public.order_items
  for each row execute function private.forbid_mutation();

create table public.order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  field text not null check (field in ('payment_status', 'fulfillment_status', 'shipment_status', 'risk_review_status', 'created', 'note')),
  from_value text,
  to_value text,
  actor_id uuid,
  actor_kind text not null default 'staff' check (actor_kind in ('customer', 'staff', 'system', 'gateway', 'courier')),
  reason text check (reason is null or char_length(reason) <= 500),
  customer_visible boolean not null default false
);
create index order_status_events_order_idx on public.order_status_events(order_id, occurred_at);
create trigger order_status_events_append_only before update or delete on public.order_status_events
  for each row execute function private.forbid_mutation();

create table public.order_notes (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  author_id uuid not null default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create trigger order_notes_append_only before update or delete on public.order_notes
  for each row execute function private.forbid_mutation();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_events enable row level security;
alter table public.order_notes enable row level security;

grant select on public.orders, public.order_items, public.order_status_events, public.order_notes to authenticated;
grant insert on public.order_notes to authenticated;

create policy "customers read own orders" on public.orders
  for select to authenticated using (user_id = (select auth.uid()));
create policy "staff read orders" on public.orders
  for select to authenticated using ((select private.has_permission('orders.read')));

create policy "customers read own order items" on public.order_items
  for select to authenticated using (exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));
create policy "staff read order items" on public.order_items
  for select to authenticated using ((select private.has_permission('orders.read')));

create policy "customers read visible order events" on public.order_status_events
  for select to authenticated using (customer_visible and exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));
create policy "staff read order events" on public.order_status_events
  for select to authenticated using ((select private.has_permission('orders.read')));

create policy "staff read order notes" on public.order_notes
  for select to authenticated using ((select private.has_permission('orders.read')));
create policy "staff add order notes" on public.order_notes
  for insert to authenticated with check (
    (select private.has_permission('orders.read')) and author_id = (select auth.uid()));
