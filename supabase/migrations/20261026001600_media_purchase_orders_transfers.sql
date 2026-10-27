-- =============================================================================
-- Fabriklo 0016 (slice 10): product photo management, purchase orders, stock
-- transfers.
--
-- Photos: rows in public.product_media are written only through the RPCs
-- below (position bookkeeping + audit). Objects live in the public
-- `product-media` bucket; the app validates, strips and re-encodes every
-- upload before it is stored.
--
-- Purchase orders and transfers: documents with lines; stock only ever moves
-- through private.apply_stock_movement (row locks, ledger, idempotency), so a
-- receive or a transfer is as safe as a manual adjustment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Storage: the storage API checks SELECT before it deletes an object, so
-- catalogue editors need read access to product-media rows (the bucket is
-- public anyway; this only affects the authenticated API path).
-- -----------------------------------------------------------------------------
create policy "catalog editors read product media objects" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-media' and (select private.has_permission('products.write')));

-- -----------------------------------------------------------------------------
-- Catalogue cards carry their primary photo
-- -----------------------------------------------------------------------------
drop function public.catalog_search(text, text, text, text, text[], text[], integer, integer, boolean, text, integer, integer);
create function public.catalog_search(
  p_query text default null,
  p_category text default null,
  p_audience text default null,
  p_collection text default null,
  p_sizes text[] default null,
  p_colors text[] default null,
  p_min_price_minor integer default null,
  p_max_price_minor integer default null,
  p_in_stock boolean default false,
  p_sort text default 'newest',
  p_limit integer default 24,
  p_offset integer default 0)
returns table (
  id uuid,
  slug text,
  title text,
  subtitle text,
  audience text,
  category_slug text,
  category_name text,
  is_demo boolean,
  featured boolean,
  tryon_enabled boolean,
  min_price_minor integer,
  max_compare_at_minor integer,
  colors jsonb,
  sizes text[],
  available integer,
  published_at timestamptz,
  image_path text,
  image_alt text,
  total_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with matching_variants as (
    select v.*
    from public.product_variants v
    where v.is_active
      and (p_sizes is null or cardinality(p_sizes) = 0 or v.size = any(p_sizes))
      and (p_colors is null or cardinality(p_colors) = 0 or v.color = any(p_colors))
      and (p_min_price_minor is null or v.price_minor >= p_min_price_minor)
      and (p_max_price_minor is null or v.price_minor <= p_max_price_minor)
  ),
  avail as (
    select a.variant_id, a.available
    from public.get_variant_availability(array(select mv.id from matching_variants mv)) a
  ),
  cards as (
    select p.id, p.slug::text, p.title, p.subtitle, p.audience,
           c.slug::text as category_slug, c.name as category_name,
           p.is_demo, p.featured, p.tryon_enabled,
           min(mv.price_minor)::integer as min_price_minor,
           max(mv.compare_at_minor)::integer as max_compare_at_minor,
           (select jsonb_agg(distinct jsonb_build_object('name', v2.color, 'hex', v2.color_hex))
              from public.product_variants v2 where v2.product_id = p.id and v2.is_active) as colors,
           array(select distinct v3.size from public.product_variants v3
                  where v3.product_id = p.id and v3.is_active order by v3.size) as sizes,
           coalesce(sum(a.available), 0)::integer as available,
           p.published_at,
           (select m.storage_path from public.product_media m
             where m.product_id = p.id and m.kind = 'image' and not m.is_tryon_garment
             order by m.position, m.created_at limit 1) as image_path,
           (select m.alt from public.product_media m
             where m.product_id = p.id and m.kind = 'image' and not m.is_tryon_garment
             order by m.position, m.created_at limit 1) as image_alt
    from public.products p
    join matching_variants mv on mv.product_id = p.id
    left join public.categories c on c.id = p.category_id
    left join avail a on a.variant_id = mv.id
    where (p_query is null or btrim(p_query) = '' or p.search @@ websearch_to_tsquery('simple', p_query)
           or p.title ilike '%' || replace(replace(left(p_query, 60), '%', ''), '_', '') || '%')
      and (p_category is null or c.slug = p_category)
      and (p_audience is null or p.audience = p_audience or (p_audience in ('men', 'women') and p.audience = 'unisex'))
      and (p_collection is null or exists (
            select 1 from public.collection_products cp
            join public.collections col on col.id = cp.collection_id
            where cp.product_id = p.id and col.slug = p_collection))
    group by p.id, c.slug, c.name
  )
  select cards.*, count(*) over () as total_count
  from cards
  where not p_in_stock or cards.available > 0
  order by
    case when p_sort = 'price_asc' then cards.min_price_minor end asc nulls last,
    case when p_sort = 'price_desc' then cards.min_price_minor end desc nulls last,
    case when p_sort = 'featured' then cards.featured end desc,
    cards.published_at desc nulls last,
    cards.slug
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.catalog_search(text, text, text, text, text[], text[], integer, integer, boolean, text, integer, integer) from public;
grant execute on function public.catalog_search(text, text, text, text, text[], text[], integer, integer, boolean, text, integer, integer) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Product photos: RPCs (direct table writes are withdrawn from staff)
-- -----------------------------------------------------------------------------
drop policy "catalog write media" on public.product_media;
revoke insert, update, delete on public.product_media from authenticated;

create or replace function public.admin_add_product_media(
  p_product_id uuid, p_storage_path text, p_alt text, p_width integer, p_height integer, p_variant_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos integer;
  v_id uuid;
begin
  if not private.has_permission('products.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'unknown product' using errcode = '22023';
  end if;
  if p_variant_id is not null and not exists (select 1 from public.product_variants where id = p_variant_id and product_id = p_product_id) then
    raise exception 'variant does not belong to this product' using errcode = '22023';
  end if;
  if (select count(*) from public.product_media where product_id = p_product_id and not is_tryon_garment) >= 12 then
    raise exception 'a product can have at most 12 photos' using errcode = '22023', hint = 'media_limit';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.product_media where product_id = p_product_id and not is_tryon_garment;
  insert into public.product_media (product_id, variant_id, kind, storage_path, alt, width, height, position, is_tryon_garment)
  values (p_product_id, p_variant_id, 'image', p_storage_path, btrim(p_alt), p_width, p_height, v_pos, false)
  returning id into v_id;
  perform private.write_audit('product.media_add', 'product', p_product_id::text, null,
    jsonb_build_object('media_id', v_id, 'storage_path', p_storage_path, 'alt', btrim(p_alt), 'variant_id', p_variant_id));
  return v_id;
end;
$$;
revoke all on function public.admin_add_product_media(uuid, text, text, integer, integer, uuid) from public;
grant execute on function public.admin_add_product_media(uuid, text, text, integer, integer, uuid) to authenticated;

create or replace function public.admin_update_product_media(p_media_id uuid, p_alt text, p_variant_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.product_media;
begin
  if not private.has_permission('products.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_before from public.product_media where id = p_media_id;
  if not found then
    raise exception 'unknown media' using errcode = '22023';
  end if;
  if p_variant_id is not null and not exists (select 1 from public.product_variants where id = p_variant_id and product_id = v_before.product_id) then
    raise exception 'variant does not belong to this product' using errcode = '22023';
  end if;
  update public.product_media set alt = btrim(p_alt), variant_id = p_variant_id where id = p_media_id;
  perform private.write_audit('product.media_update', 'product', v_before.product_id::text,
    jsonb_build_object('media_id', p_media_id, 'alt', v_before.alt, 'variant_id', v_before.variant_id),
    jsonb_build_object('media_id', p_media_id, 'alt', btrim(p_alt), 'variant_id', p_variant_id));
end;
$$;
revoke all on function public.admin_update_product_media(uuid, text, uuid) from public;
grant execute on function public.admin_update_product_media(uuid, text, uuid) to authenticated;

-- Full ordering of a product's gallery (garment reference photos keep their own slot).
create or replace function public.admin_reorder_product_media(p_product_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.has_permission('products.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select count(*) into v_count from public.product_media where product_id = p_product_id and not is_tryon_garment;
  if p_ids is null or cardinality(p_ids) <> v_count
     or (select count(distinct x) from unnest(p_ids) x) <> v_count
     or exists (select 1 from unnest(p_ids) x where not exists (
          select 1 from public.product_media m where m.id = x and m.product_id = p_product_id and not m.is_tryon_garment)) then
    raise exception 'the order must list each photo of this product exactly once' using errcode = '22023';
  end if;
  update public.product_media m
     set position = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where m.id = o.id;
  perform private.write_audit('product.media_reorder', 'product', p_product_id::text, null, jsonb_build_object('order', to_jsonb(p_ids)));
end;
$$;
revoke all on function public.admin_reorder_product_media(uuid, uuid[]) from public;
grant execute on function public.admin_reorder_product_media(uuid, uuid[]) to authenticated;

-- Returns the storage path so the caller can remove the object afterwards.
create or replace function public.admin_delete_product_media(p_media_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.product_media;
begin
  if not private.has_permission('products.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.product_media where id = p_media_id returning * into v_row;
  if not found then
    raise exception 'unknown media' using errcode = '22023';
  end if;
  if v_row.is_tryon_garment and not exists (
       select 1 from public.product_media where product_id = v_row.product_id and is_tryon_garment) then
    update public.products set tryon_enabled = false where id = v_row.product_id;
  end if;
  perform private.write_audit('product.media_delete', 'product', v_row.product_id::text, to_jsonb(v_row), null);
  return v_row.storage_path;
end;
$$;
revoke all on function public.admin_delete_product_media(uuid) from public;
grant execute on function public.admin_delete_product_media(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Purchase orders
-- -----------------------------------------------------------------------------
alter table public.stock_movements drop constraint stock_movements_reference_type_check;
alter table public.stock_movements add constraint stock_movements_reference_type_check
  check (reference_type is null or reference_type in ('order', 'reservation', 'adjustment', 'purchase_order', 'return', 'seed', 'transfer'));

create sequence private.purchase_order_seq;
create sequence private.stock_transfer_seq;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  supplier_name text not null check (char_length(supplier_name) between 2 and 120),
  supplier_ref text check (supplier_ref is null or char_length(supplier_ref) <= 80),
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
  expected_at date,
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ordered_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz
);
create index purchase_orders_status_idx on public.purchase_orders(status, created_at desc);
create trigger purchase_orders_updated_at before update on public.purchase_orders
  for each row execute function private.set_updated_at();

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity_ordered integer not null check (quantity_ordered > 0 and quantity_ordered <= 100000),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  unit_cost_minor bigint check (unit_cost_minor is null or unit_cost_minor >= 0),
  position integer not null default 0,
  unique (purchase_order_id, variant_id),
  constraint purchase_order_lines_received_within_ordered check (quantity_received <= quantity_ordered)
);

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  from_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  to_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received', 'cancelled')),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  constraint stock_transfers_distinct_warehouses check (from_warehouse_id <> to_warehouse_id)
);
create index stock_transfers_status_idx on public.stock_transfers(status, created_at desc);
create trigger stock_transfers_updated_at before update on public.stock_transfers
  for each row execute function private.set_updated_at();

create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0 and quantity <= 100000),
  position integer not null default 0,
  unique (transfer_id, variant_id)
);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;

-- Reads via RLS (unit costs stay behind products.costs through column grants);
-- every write goes through the RPCs below.
grant select on public.purchase_orders, public.stock_transfers, public.stock_transfer_lines to authenticated;
grant select (id, purchase_order_id, variant_id, quantity_ordered, quantity_received, position) on public.purchase_order_lines to authenticated;

create policy "inventory read purchase orders" on public.purchase_orders
  for select to authenticated using ((select private.has_permission('inventory.read')));
create policy "inventory read purchase order lines" on public.purchase_order_lines
  for select to authenticated using ((select private.has_permission('inventory.read')));
create policy "inventory read transfers" on public.stock_transfers
  for select to authenticated using ((select private.has_permission('inventory.read')));
create policy "inventory read transfer lines" on public.stock_transfer_lines
  for select to authenticated using ((select private.has_permission('inventory.read')));

-- Detail with costs (only for products.costs holders).
create or replace function public.admin_po_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_cost boolean;
begin
  if not private.has_permission('inventory.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_can_cost := private.has_permission('products.costs');
  return (
    select jsonb_build_object(
      'id', po.id, 'number', po.number, 'supplier_name', po.supplier_name, 'supplier_ref', po.supplier_ref,
      'warehouse_id', po.warehouse_id, 'warehouse_name', w.name, 'status', po.status, 'expected_at', po.expected_at,
      'note', po.note, 'created_at', po.created_at, 'ordered_at', po.ordered_at, 'received_at', po.received_at,
      'cancelled_at', po.cancelled_at,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id, 'variant_id', l.variant_id, 'sku', v.sku, 'size', v.size, 'color', v.color,
          'product_title', p.title, 'quantity_ordered', l.quantity_ordered, 'quantity_received', l.quantity_received,
          'unit_cost_minor', case when v_can_cost then l.unit_cost_minor else null end) order by l.position, v.sku)
        from public.purchase_order_lines l
        join public.product_variants v on v.id = l.variant_id
        join public.products p on p.id = v.product_id
        where l.purchase_order_id = po.id), '[]'::jsonb))
    from public.purchase_orders po
    join public.warehouses w on w.id = po.warehouse_id
    where po.id = p_id);
end;
$$;
revoke all on function public.admin_po_detail(uuid) from public;
grant execute on function public.admin_po_detail(uuid) to authenticated;

-- Create or replace a draft (lines are replaced as a set).
create or replace function public.admin_po_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_number text;
  v_status text;
  v_warehouse uuid := (p->>'warehouse_id')::uuid;
  v_can_cost boolean;
  v_line jsonb;
  v_i integer := 0;
  v_seen uuid[] := '{}'::uuid[];
begin
  if not private.has_permission('inventory.adjust') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(char_length(btrim(p->>'supplier_name')), 0) < 2 then
    raise exception 'supplier name is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.warehouses where id = v_warehouse and is_active) then
    raise exception 'unknown warehouse' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception 'add at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p->'lines') > 200 then
    raise exception 'too many lines' using errcode = '22023';
  end if;
  v_can_cost := private.has_permission('products.costs');

  if p ? 'id' and p->>'id' is not null then
    v_id := (p->>'id')::uuid;
    select status into v_status from public.purchase_orders where id = v_id for update;
    if not found then
      raise exception 'unknown purchase order' using errcode = '22023';
    end if;
    if v_status <> 'draft' then
      raise exception 'only draft purchase orders can be edited' using errcode = '22023', hint = 'not_draft';
    end if;
    update public.purchase_orders
       set supplier_name = btrim(p->>'supplier_name'), supplier_ref = nullif(btrim(p->>'supplier_ref'), ''),
           warehouse_id = v_warehouse, expected_at = (p->>'expected_at')::date, note = nullif(btrim(p->>'note'), '')
     where id = v_id;
    delete from public.purchase_order_lines where purchase_order_id = v_id;
  else
    v_number := 'PO-' || lpad(nextval('private.purchase_order_seq')::text, 6, '0');
    insert into public.purchase_orders (number, supplier_name, supplier_ref, warehouse_id, expected_at, note, created_by)
    values (v_number, btrim(p->>'supplier_name'), nullif(btrim(p->>'supplier_ref'), ''), v_warehouse,
            (p->>'expected_at')::date, nullif(btrim(p->>'note'), ''), (select auth.uid()))
    returning id into v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_i := v_i + 1;
    if (v_line->>'variant_id')::uuid = any(v_seen) then
      raise exception 'a variant appears twice' using errcode = '22023';
    end if;
    v_seen := v_seen || (v_line->>'variant_id')::uuid;
    if not exists (select 1 from public.product_variants where id = (v_line->>'variant_id')::uuid) then
      raise exception 'unknown variant' using errcode = '22023';
    end if;
    if coalesce((v_line->>'quantity')::integer, 0) < 1 or (v_line->>'quantity')::integer > 100000 then
      raise exception 'quantity must be between 1 and 100000' using errcode = '22023';
    end if;
    insert into public.purchase_order_lines (purchase_order_id, variant_id, quantity_ordered, unit_cost_minor, position)
    values (v_id, (v_line->>'variant_id')::uuid, (v_line->>'quantity')::integer,
            case when v_can_cost then (v_line->>'unit_cost_minor')::bigint else null end, v_i);
  end loop;

  select number into v_number from public.purchase_orders where id = v_id;
  perform private.write_audit('inventory.po_save', 'purchase_order', v_id::text, null, p - 'lines' || jsonb_build_object('line_count', v_i));
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;
revoke all on function public.admin_po_save(jsonb) from public;
grant execute on function public.admin_po_save(jsonb) to authenticated;

create or replace function public.admin_po_set_status(p_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  if not private.has_permission('inventory.adjust') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_po from public.purchase_orders where id = p_id for update;
  if not found then
    raise exception 'unknown purchase order' using errcode = '22023';
  end if;
  if p_status = 'ordered' then
    if v_po.status <> 'draft' then
      raise exception 'only a draft can be marked as ordered' using errcode = '22023', hint = 'bad_transition';
    end if;
    if not exists (select 1 from public.purchase_order_lines where purchase_order_id = p_id) then
      raise exception 'add at least one line' using errcode = '22023';
    end if;
    update public.purchase_orders set status = 'ordered', ordered_at = now() where id = p_id;
  elsif p_status = 'cancelled' then
    if v_po.status not in ('draft', 'ordered', 'partially_received') then
      raise exception 'this purchase order cannot be cancelled' using errcode = '22023', hint = 'bad_transition';
    end if;
    update public.purchase_orders set status = 'cancelled', cancelled_at = now() where id = p_id;
  else
    raise exception 'unknown status' using errcode = '22023';
  end if;
  perform private.write_audit('inventory.po_status', 'purchase_order', p_id::text,
    jsonb_build_object('status', v_po.status), jsonb_build_object('status', p_status), p_reason);
end;
$$;
revoke all on function public.admin_po_set_status(uuid, text, text) from public;
grant execute on function public.admin_po_set_status(uuid, text, text) to authenticated;

-- Receive quantities against lines: each line becomes one idempotent 'receive'
-- movement referencing the purchase order. Received costs update the variant's
-- private cost price when the caller may see costs.
create or replace function public.admin_po_receive(p_id uuid, p_lines jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
  v_line public.purchase_order_lines;
  v_item jsonb;
  v_qty integer;
  v_moved integer := 0;
  v_total_ordered integer;
  v_total_received integer;
begin
  if not private.has_permission('inventory.adjust') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select * into v_po from public.purchase_orders where id = p_id for update;
  if not found then
    raise exception 'unknown purchase order' using errcode = '22023';
  end if;
  if v_po.status not in ('ordered', 'partially_received') then
    raise exception 'only ordered purchase orders can be received' using errcode = '22023', hint = 'bad_transition';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'nothing to receive' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_item->>'quantity')::integer, 0);
    if v_qty = 0 then continue; end if;
    if v_qty < 0 then
      raise exception 'received quantity must be positive' using errcode = '22023';
    end if;
    select * into v_line from public.purchase_order_lines
     where id = (v_item->>'line_id')::uuid and purchase_order_id = p_id for update;
    if not found then
      raise exception 'unknown line' using errcode = '22023';
    end if;
    -- Replays of the same key are no-ops (the movement already exists).
    if exists (select 1 from public.stock_movements sm where sm.idempotency_key = 'po:' || p_idempotency_key || ':' || v_line.id::text) then
      continue;
    end if;
    if v_line.quantity_received + v_qty > v_line.quantity_ordered then
      raise exception 'cannot receive more than ordered on %', v_line.id using errcode = '22023', hint = 'over_receive';
    end if;
    perform private.apply_stock_movement(v_line.variant_id, v_po.warehouse_id, 'receive', v_qty, 0,
      'Received against ' || v_po.number, 'purchase_order', v_po.id::text,
      'po:' || p_idempotency_key || ':' || v_line.id::text);
    update public.purchase_order_lines set quantity_received = quantity_received + v_qty where id = v_line.id;
    v_moved := v_moved + v_qty;
    if v_line.unit_cost_minor is not null and private.has_permission('products.costs') then
      insert into public.variant_costs (variant_id, cost_minor)
      values (v_line.variant_id, least(v_line.unit_cost_minor, 2000000000)::integer)
      on conflict (variant_id) do update set cost_minor = excluded.cost_minor;
    end if;
  end loop;

  select sum(quantity_ordered), sum(quantity_received) into v_total_ordered, v_total_received
    from public.purchase_order_lines where purchase_order_id = p_id;
  update public.purchase_orders
     set status = case when v_total_received >= v_total_ordered then 'received' else 'partially_received' end,
         received_at = case when v_total_received >= v_total_ordered then now() else received_at end
   where id = p_id;

  perform private.write_audit('inventory.po_receive', 'purchase_order', p_id::text, null,
    jsonb_build_object('received_units', v_moved, 'lines', p_lines, 'idempotency_key', p_idempotency_key));
  return jsonb_build_object('received_units', v_moved, 'status',
    case when v_total_received >= v_total_ordered then 'received' else 'partially_received' end);
end;
$$;
revoke all on function public.admin_po_receive(uuid, jsonb, text) from public;
grant execute on function public.admin_po_receive(uuid, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Stock transfers between warehouses
-- -----------------------------------------------------------------------------
create or replace function public.admin_transfer_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_number text;
  v_status text;
  v_from uuid := (p->>'from_warehouse_id')::uuid;
  v_to uuid := (p->>'to_warehouse_id')::uuid;
  v_line jsonb;
  v_i integer := 0;
  v_seen uuid[] := '{}'::uuid[];
begin
  if not private.has_permission('inventory.adjust') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_from is null or v_to is null or v_from = v_to then
    raise exception 'choose two different warehouses' using errcode = '22023';
  end if;
  if (select count(*) from public.warehouses where id in (v_from, v_to) and is_active) <> 2 then
    raise exception 'unknown warehouse' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception 'add at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p->'lines') > 200 then
    raise exception 'too many lines' using errcode = '22023';
  end if;

  if p ? 'id' and p->>'id' is not null then
    v_id := (p->>'id')::uuid;
    select status into v_status from public.stock_transfers where id = v_id for update;
    if not found then
      raise exception 'unknown transfer' using errcode = '22023';
    end if;
    if v_status <> 'draft' then
      raise exception 'only draft transfers can be edited' using errcode = '22023', hint = 'not_draft';
    end if;
    update public.stock_transfers
       set from_warehouse_id = v_from, to_warehouse_id = v_to, note = nullif(btrim(p->>'note'), '')
     where id = v_id;
    delete from public.stock_transfer_lines where transfer_id = v_id;
  else
    v_number := 'TR-' || lpad(nextval('private.stock_transfer_seq')::text, 6, '0');
    insert into public.stock_transfers (number, from_warehouse_id, to_warehouse_id, note, created_by)
    values (v_number, v_from, v_to, nullif(btrim(p->>'note'), ''), (select auth.uid()))
    returning id into v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_i := v_i + 1;
    if (v_line->>'variant_id')::uuid = any(v_seen) then
      raise exception 'a variant appears twice' using errcode = '22023';
    end if;
    v_seen := v_seen || (v_line->>'variant_id')::uuid;
    if not exists (select 1 from public.product_variants where id = (v_line->>'variant_id')::uuid) then
      raise exception 'unknown variant' using errcode = '22023';
    end if;
    if coalesce((v_line->>'quantity')::integer, 0) < 1 or (v_line->>'quantity')::integer > 100000 then
      raise exception 'quantity must be between 1 and 100000' using errcode = '22023';
    end if;
    insert into public.stock_transfer_lines (transfer_id, variant_id, quantity, position)
    values (v_id, (v_line->>'variant_id')::uuid, (v_line->>'quantity')::integer, v_i);
  end loop;

  select number into v_number from public.stock_transfers where id = v_id;
  perform private.write_audit('inventory.transfer_save', 'stock_transfer', v_id::text, null, p - 'lines' || jsonb_build_object('line_count', v_i));
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;
revoke all on function public.admin_transfer_save(jsonb) from public;
grant execute on function public.admin_transfer_save(jsonb) to authenticated;

-- draft → sent (stock leaves the source now), sent → received (arrives at the
-- destination), draft/sent → cancelled (a sent transfer goes back to the source).
create or replace function public.admin_transfer_set_status(p_id uuid, p_status text, p_idempotency_key text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.stock_transfers;
  v_line public.stock_transfer_lines;
  v_units integer := 0;
begin
  if not private.has_permission('inventory.adjust') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select * into v_t from public.stock_transfers where id = p_id for update;
  if not found then
    raise exception 'unknown transfer' using errcode = '22023';
  end if;

  if p_status = 'sent' and v_t.status = 'draft' then
    if not exists (select 1 from public.stock_transfer_lines where transfer_id = p_id) then
      raise exception 'add at least one line' using errcode = '22023';
    end if;
    for v_line in select * from public.stock_transfer_lines where transfer_id = p_id order by position loop
      perform private.apply_stock_movement(v_line.variant_id, v_t.from_warehouse_id, 'transfer_out', -v_line.quantity, 0,
        'Transfer ' || v_t.number || ' out', 'transfer', v_t.id::text, 'tr-out:' || p_idempotency_key || ':' || v_line.id::text);
      v_units := v_units + v_line.quantity;
    end loop;
    update public.stock_transfers set status = 'sent', sent_at = now() where id = p_id;
  elsif p_status = 'received' and v_t.status = 'sent' then
    for v_line in select * from public.stock_transfer_lines where transfer_id = p_id order by position loop
      perform private.apply_stock_movement(v_line.variant_id, v_t.to_warehouse_id, 'transfer_in', v_line.quantity, 0,
        'Transfer ' || v_t.number || ' in', 'transfer', v_t.id::text, 'tr-in:' || p_idempotency_key || ':' || v_line.id::text);
      v_units := v_units + v_line.quantity;
    end loop;
    update public.stock_transfers set status = 'received', received_at = now() where id = p_id;
  elsif p_status = 'cancelled' and v_t.status in ('draft', 'sent') then
    if v_t.status = 'sent' then
      for v_line in select * from public.stock_transfer_lines where transfer_id = p_id order by position loop
        perform private.apply_stock_movement(v_line.variant_id, v_t.from_warehouse_id, 'transfer_in', v_line.quantity, 0,
          'Transfer ' || v_t.number || ' cancelled, returned to source', 'transfer', v_t.id::text, 'tr-cancel:' || p_idempotency_key || ':' || v_line.id::text);
        v_units := v_units + v_line.quantity;
      end loop;
    end if;
    update public.stock_transfers set status = 'cancelled', cancelled_at = now() where id = p_id;
  else
    raise exception 'transfer cannot go from % to %', v_t.status, p_status using errcode = '22023', hint = 'bad_transition';
  end if;

  perform private.write_audit('inventory.transfer_status', 'stock_transfer', p_id::text,
    jsonb_build_object('status', v_t.status), jsonb_build_object('status', p_status, 'units', v_units, 'idempotency_key', p_idempotency_key), p_reason);
  return jsonb_build_object('status', p_status, 'units', v_units);
end;
$$;
revoke all on function public.admin_transfer_set_status(uuid, text, text, text) from public;
grant execute on function public.admin_transfer_set_status(uuid, text, text, text) to authenticated;

-- Variant picker for documents (staff with inventory.read): sku search.
create or replace function public.admin_variant_search(p_query text, p_limit integer default 20)
returns table (variant_id uuid, sku text, size text, color text, product_title text, product_status text)
language sql
stable
security invoker
set search_path = ''
as $$
  select v.id, v.sku::text, v.size, v.color, p.title, p.status
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where (select private.has_permission('inventory.read'))
    and p.status <> 'archived'
    and (p_query is null or btrim(p_query) = '' or v.sku ilike '%' || left(btrim(p_query), 40) || '%'
         or p.title ilike '%' || left(btrim(p_query), 40) || '%')
  order by p.title, v.sku
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
revoke all on function public.admin_variant_search(text, integer) from public;
grant execute on function public.admin_variant_search(text, integer) to authenticated;
