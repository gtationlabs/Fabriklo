-- =============================================================================
-- Fabriklo 0003: inventory (warehouses, balances, append-only ledger, reservations)
-- Stock is NEVER written directly by clients. All changes go through
-- SECURITY DEFINER functions that lock rows, validate, and append a ledger entry.
-- =============================================================================

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name text not null check (char_length(name) between 2 and 80),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index warehouses_single_default on public.warehouses(is_default) where is_default;

create table public.stock_balances (
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  damaged integer not null default 0 check (damaged >= 0),
  reorder_point integer not null default 3 check (reorder_point >= 0),
  updated_at timestamptz not null default now(),
  primary key (variant_id, warehouse_id),
  constraint stock_reserved_within_on_hand check (reserved <= on_hand)
);
create index stock_balances_warehouse_idx on public.stock_balances(warehouse_id);
create trigger stock_balances_updated_at before update on public.stock_balances
  for each row execute function private.set_updated_at();

create table public.stock_movements (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  movement_type text not null check (movement_type in (
    'receive', 'adjust', 'reserve', 'release', 'expire', 'commit', 'return', 'damage', 'transfer_in', 'transfer_out')),
  on_hand_delta integer not null default 0,
  reserved_delta integer not null default 0,
  on_hand_after integer not null,
  reserved_after integer not null,
  reason text check (reason is null or char_length(reason) <= 500),
  reference_type text check (reference_type is null or reference_type in ('order', 'reservation', 'adjustment', 'purchase_order', 'return', 'seed')),
  reference_id text,
  idempotency_key text unique check (idempotency_key is null or char_length(idempotency_key) between 8 and 120),
  actor_id uuid
);
create index stock_movements_variant_idx on public.stock_movements(variant_id, occurred_at desc);
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function private.forbid_mutation();

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  quantity integer not null check (quantity > 0 and quantity <= 100),
  order_id uuid,
  status text not null default 'active' check (status in ('active', 'committed', 'released', 'expired')),
  expires_at timestamptz not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index inventory_reservations_active_expiry_idx on public.inventory_reservations(expires_at) where status = 'active';
create index inventory_reservations_order_idx on public.inventory_reservations(order_id);

alter table public.warehouses enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_movements enable row level security;
alter table public.inventory_reservations enable row level security;

-- Read-only for staff with inventory.read; NO write grants to any client role.
grant select on public.warehouses, public.stock_balances, public.stock_movements,
  public.inventory_reservations to authenticated;

create policy "inventory read warehouses" on public.warehouses
  for select to authenticated using ((select private.has_permission('inventory.read')));
create policy "inventory read balances" on public.stock_balances
  for select to authenticated using ((select private.has_permission('inventory.read')));
create policy "inventory read movements" on public.stock_movements
  for select to authenticated using ((select private.has_permission('inventory.read')));
create policy "inventory read reservations" on public.inventory_reservations
  for select to authenticated using ((select private.has_permission('inventory.read')));

-- -----------------------------------------------------------------------------
-- Settings used by inventory rules (non-secret, staff-tunable later via CMS settings)
-- -----------------------------------------------------------------------------
create table private.inventory_settings (
  id boolean primary key default true check (id),
  large_adjustment_threshold integer not null default 200 check (large_adjustment_threshold > 0),
  reservation_minutes integer not null default 20 check (reservation_minutes between 5 and 1440)
);
insert into private.inventory_settings default values;

-- -----------------------------------------------------------------------------
-- Public availability (published variants only; exact counts capped)
-- -----------------------------------------------------------------------------
create or replace function public.get_variant_availability(p_variant_ids uuid[])
returns table (variant_id uuid, available integer)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id,
         least(coalesce(sum(greatest(sb.on_hand - sb.reserved, 0))
                 filter (where w.is_active), 0), 99)::integer
  from public.product_variants v
  left join public.stock_balances sb on sb.variant_id = v.id
  left join public.warehouses w on w.id = sb.warehouse_id
  where v.id = any(p_variant_ids[1:200])
    and v.is_active
    and private.product_is_public(v.product_id)
  group by v.id;
$$;
revoke all on function public.get_variant_availability(uuid[]) from public;
grant execute on function public.get_variant_availability(uuid[]) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Core primitive: apply a movement under a row lock. Internal only.
-- -----------------------------------------------------------------------------
create or replace function private.apply_stock_movement(
  p_variant_id uuid, p_warehouse_id uuid, p_type text,
  p_on_hand_delta integer, p_reserved_delta integer,
  p_reason text, p_reference_type text, p_reference_id text, p_idempotency_key text)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance public.stock_balances;
  v_existing public.stock_movements;
  v_result public.stock_movements;
begin
  if p_idempotency_key is not null then
    select * into v_existing from public.stock_movements where idempotency_key = p_idempotency_key;
    if found then
      return v_existing; -- replay: no double application
    end if;
  end if;

  insert into public.stock_balances (variant_id, warehouse_id)
  values (p_variant_id, p_warehouse_id)
  on conflict (variant_id, warehouse_id) do nothing;

  select * into v_balance from public.stock_balances
  where variant_id = p_variant_id and warehouse_id = p_warehouse_id
  for update;

  if v_balance.on_hand + p_on_hand_delta < 0 then
    raise exception 'insufficient on-hand stock' using errcode = 'P0001', hint = 'stock_negative';
  end if;
  if v_balance.reserved + p_reserved_delta < 0 then
    raise exception 'reservation underflow' using errcode = 'P0001', hint = 'reserved_negative';
  end if;
  if v_balance.reserved + p_reserved_delta > v_balance.on_hand + p_on_hand_delta then
    raise exception 'insufficient available stock' using errcode = 'P0001', hint = 'stock_unavailable';
  end if;

  update public.stock_balances
     set on_hand = on_hand + p_on_hand_delta,
         reserved = reserved + p_reserved_delta
   where variant_id = p_variant_id and warehouse_id = p_warehouse_id
  returning * into v_balance;

  insert into public.stock_movements (variant_id, warehouse_id, movement_type, on_hand_delta, reserved_delta,
    on_hand_after, reserved_after, reason, reference_type, reference_id, idempotency_key, actor_id)
  values (p_variant_id, p_warehouse_id, p_type, p_on_hand_delta, p_reserved_delta,
    v_balance.on_hand, v_balance.reserved, p_reason, p_reference_type, p_reference_id, p_idempotency_key,
    (select auth.uid()))
  returning * into v_result;
  return v_result;
end;
$$;
revoke all on function private.apply_stock_movement(uuid, uuid, text, integer, integer, text, text, text, text) from public;

-- -----------------------------------------------------------------------------
-- Staff RPC: manual adjustment / receiving with reason + idempotency
-- -----------------------------------------------------------------------------
create or replace function public.admin_adjust_stock(
  p_variant_id uuid,
  p_warehouse_id uuid,
  p_delta integer,
  p_movement_type text,
  p_reason text,
  p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threshold integer;
  v_move public.stock_movements;
begin
  if not private.has_permission('inventory.adjust') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_movement_type not in ('receive', 'adjust', 'damage', 'return') then
    raise exception 'invalid movement type' using errcode = '22023';
  end if;
  if p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  if p_movement_type = 'receive' and p_delta < 0 then
    raise exception 'receiving must be positive' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and is_active) then
    raise exception 'unknown warehouse' using errcode = '22023';
  end if;
  if not exists (select 1 from public.product_variants where id = p_variant_id) then
    raise exception 'unknown variant' using errcode = '22023';
  end if;

  select large_adjustment_threshold into v_threshold from private.inventory_settings;
  if abs(p_delta) > v_threshold and not private.has_permission('inventory.approve_large') then
    raise exception 'adjustment exceeds % units and needs approval permission', v_threshold using errcode = '42501';
  end if;

  v_move := private.apply_stock_movement(p_variant_id, p_warehouse_id, p_movement_type,
    p_delta, 0, btrim(p_reason), 'adjustment', null, 'adj:' || p_idempotency_key);

  perform private.write_audit('inventory.adjust', 'product_variant', p_variant_id::text,
    null, to_jsonb(v_move), btrim(p_reason));

  return jsonb_build_object('movement_id', v_move.id, 'on_hand', v_move.on_hand_after, 'reserved', v_move.reserved_after);
end;
$$;
revoke all on function public.admin_adjust_stock(uuid, uuid, integer, text, text, text) from public;
grant execute on function public.admin_adjust_stock(uuid, uuid, integer, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Reservations (used by checkout in the order slice). Internal, called only by
-- other SECURITY DEFINER functions.
-- -----------------------------------------------------------------------------
create or replace function private.reserve_stock(
  p_variant_id uuid, p_quantity integer, p_order_id uuid, p_idempotency_key text, p_minutes integer default null)
returns public.inventory_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.inventory_reservations;
  v_wh uuid;
  v_minutes integer;
  v_res public.inventory_reservations;
begin
  select * into v_existing from public.inventory_reservations where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select coalesce(p_minutes, reservation_minutes) into v_minutes from private.inventory_settings;

  -- Pick the active warehouse with the most available units; lock the row so two
  -- concurrent checkouts cannot both take the last unit.
  select sb.warehouse_id into v_wh
  from public.stock_balances sb
  join public.warehouses w on w.id = sb.warehouse_id and w.is_active
  where sb.variant_id = p_variant_id and sb.on_hand - sb.reserved >= p_quantity
  order by (sb.on_hand - sb.reserved) desc, w.is_default desc
  limit 1
  for update of sb;

  if v_wh is null then
    raise exception 'insufficient available stock' using errcode = 'P0001', hint = 'stock_unavailable';
  end if;

  insert into public.inventory_reservations (variant_id, warehouse_id, quantity, order_id, expires_at, idempotency_key)
  values (p_variant_id, v_wh, p_quantity, p_order_id, now() + make_interval(mins => v_minutes), p_idempotency_key)
  returning * into v_res;

  perform private.apply_stock_movement(p_variant_id, v_wh, 'reserve', 0, p_quantity,
    null, 'reservation', v_res.id::text, 'res:' || v_res.id::text);
  return v_res;
end;
$$;
revoke all on function private.reserve_stock(uuid, integer, uuid, text, integer) from public;

-- Close a reservation exactly once. p_outcome: 'released' | 'expired' | 'committed'.
create or replace function private.close_reservation(p_reservation_id uuid, p_outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.inventory_reservations;
begin
  if p_outcome not in ('released', 'expired', 'committed') then
    raise exception 'invalid outcome' using errcode = '22023';
  end if;
  select * into v_res from public.inventory_reservations where id = p_reservation_id for update;
  if not found or v_res.status <> 'active' then
    return false; -- already closed: idempotent no-op
  end if;

  if p_outcome = 'committed' then
    -- Units leave on_hand and the reservation at the same time.
    perform private.apply_stock_movement(v_res.variant_id, v_res.warehouse_id, 'commit',
      -v_res.quantity, -v_res.quantity, null, 'reservation', v_res.id::text, 'commit:' || v_res.id::text);
  else
    perform private.apply_stock_movement(v_res.variant_id, v_res.warehouse_id,
      case when p_outcome = 'expired' then 'expire' else 'release' end,
      0, -v_res.quantity, null, 'reservation', v_res.id::text, 'close:' || v_res.id::text);
  end if;

  update public.inventory_reservations set status = p_outcome, closed_at = now() where id = v_res.id;
  return true;
end;
$$;
revoke all on function private.close_reservation(uuid, text) from public;

-- Worker entry point (service_role / pg_cron). Returns number released.
create or replace function public.release_expired_reservations(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.inventory_reservations
    where status = 'active' and expires_at <= now()
    order by expires_at
    limit greatest(least(p_limit, 5000), 1)
    for update skip locked
  loop
    if private.close_reservation(v_id, 'expired') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.release_expired_reservations(integer) from public, anon, authenticated;
grant execute on function public.release_expired_reservations(integer) to service_role;
