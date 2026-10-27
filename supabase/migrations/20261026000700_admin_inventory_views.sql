-- =============================================================================
-- Fabriklo 0007: admin inventory read helpers. SECURITY INVOKER: callers only see
-- what RLS allows (inventory.read + aal2); others get empty results.
-- =============================================================================

create or replace function public.admin_variant_stock(p_only_alerts boolean default false, p_limit integer default 200)
returns table (
  variant_id uuid,
  product_id uuid,
  product_title text,
  product_status text,
  sku text,
  size text,
  color text,
  on_hand integer,
  reserved integer,
  available integer,
  reorder_point integer,
  alert text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from (
    select v.id as variant_id, p.id as product_id, p.title as product_title, p.status as product_status,
           v.sku::text as sku, v.size, v.color,
           coalesce(sum(sb.on_hand), 0)::integer as on_hand,
           coalesce(sum(sb.reserved), 0)::integer as reserved,
           coalesce(sum(sb.on_hand - sb.reserved), 0)::integer as available,
           coalesce(max(sb.reorder_point), 3)::integer as reorder_point,
           case
             when coalesce(sum(sb.on_hand - sb.reserved), 0) <= 0 then 'out'
             when coalesce(sum(sb.on_hand - sb.reserved), 0) <= coalesce(max(sb.reorder_point), 3) then 'low'
             else null end as alert
    from public.product_variants v
    join public.products p on p.id = v.product_id
    left join public.stock_balances sb on sb.variant_id = v.id
    where v.is_active and p.status <> 'archived'
      and (select private.has_permission('inventory.read'))
    group by v.id, p.id
  ) s
  where not p_only_alerts or s.alert is not null
  order by s.alert nulls last, s.available, s.product_title, s.sku
  limit least(greatest(p_limit, 1), 1000);
$$;
revoke all on function public.admin_variant_stock(boolean, integer) from public;
grant execute on function public.admin_variant_stock(boolean, integer) to authenticated;

create or replace function public.admin_stock_alerts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'low', count(*) filter (where alert = 'low'),
    'out', count(*) filter (where alert = 'out'))
  from public.admin_variant_stock(true, 1000);
$$;
revoke all on function public.admin_stock_alerts() from public;
grant execute on function public.admin_stock_alerts() to authenticated;
