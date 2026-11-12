-- Role-scoped statistics for the admin dashboard.
--
-- public.admin_dashboard_stats(p_days) returns one jsonb document. Each section is
-- present only when the caller holds the permission that the matching table's RLS
-- policy asks for, so a role never sees a figure it could not read row by row:
--
--   sales      analytics.read + orders.read  revenue, AOV, payment mix, COD delivered but not yet collected, top products, category sales
--   orders     orders.read                   counts, pipeline, daily counts, recent orders, open checkout leads
--                                             (order amounts only when the sales section is allowed too)
--   risk       risk.review                   orders waiting for review
--   catalog    products.read                 products by status, categories, products per category
--   inventory  inventory.read                low / sold-out SKUs, sellable units
--   customers  customers.read                customers, new customers (repeat rate needs orders.read)
--   reviews    reviews.moderate              pending reviews, average rating
--   activity   audit.read                    latest audit events
--
-- The function is SECURITY DEFINER only so that it can aggregate in one round trip
-- and exclude staff accounts from customer counts; every section is gated with the
-- same private.has_permission() check its tables' RLS policies use. Nothing is
-- estimated: a metric with no rows is 0. Days are calendar days in Asia/Dhaka.
--
-- "Revenue" = order totals (incl. delivery, after discounts) of orders placed in the
-- window that are not cancelled, not failed/voided/refunded and not returned.

create or replace function public.admin_dashboard_stats(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_tz constant text := 'Asia/Dhaka';
  v_today date := (now() at time zone v_tz)::date;
  v_start date := v_today - (v_days - 1);
  v_prev_start date := v_today - (2 * v_days - 1);
  v_from timestamptz := (v_start::timestamp at time zone v_tz);
  v_prev_from timestamptz := (v_prev_start::timestamp at time zone v_tz);
  v_today_from timestamptz := (v_today::timestamp at time zone v_tz);
  can_orders boolean := private.has_permission('orders.read');
  can_sales boolean := private.has_permission('analytics.read') and private.has_permission('orders.read');
  can_products boolean := private.has_permission('products.read');
  can_inventory boolean := private.has_permission('inventory.read');
  can_customers boolean := private.has_permission('customers.read');
  can_risk boolean := private.has_permission('risk.review');
  can_reviews boolean := private.has_permission('reviews.moderate');
  can_audit boolean := private.has_permission('audit.read');
  result jsonb;
begin
  if not private.is_active_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;

  result := jsonb_build_object(
    'days', v_days,
    'from', v_start,
    'to', v_today,
    'generated_at', now(),
    'scope', jsonb_build_object(
      'sales', can_sales, 'orders', can_orders, 'risk', can_risk, 'catalog', can_products,
      'inventory', can_inventory, 'customers', can_customers, 'reviews', can_reviews, 'activity', can_audit));

  -- Sales -----------------------------------------------------------------
  if can_sales then
    result := result || jsonb_build_object('sales', (
      with counted as (
        select o.id, o.total_minor, o.payment_method, o.placed_at,
               (o.placed_at at time zone v_tz)::date as d
        from public.orders o
        where o.placed_at >= v_prev_from
          and o.fulfillment_status <> 'cancelled'
          and o.payment_status not in ('failed', 'voided', 'refunded')
          and o.shipment_status not in ('rto', 'returned')
      ),
      cur as (select * from counted where placed_at >= v_from),
      prev as (select * from counted where placed_at < v_from),
      days as (
        select g::date as d from generate_series(v_start, v_today, interval '1 day') g
      ),
      daily as (
        select days.d,
               coalesce(sum(cur.total_minor), 0)::bigint as revenue_minor,
               count(cur.id)::int as orders
        from days left join cur on cur.d = days.d
        group by days.d
      ),
      items as (
        select oi.product_title, oi.quantity, oi.line_total_minor, c.name as category
        from cur
        join public.order_items oi on oi.order_id = cur.id
        left join public.product_variants v on v.id = oi.variant_id
        left join public.products p on p.id = v.product_id
        left join public.categories c on c.id = p.category_id
      )
      select jsonb_build_object(
        'revenue_minor', (select coalesce(sum(total_minor), 0)::bigint from cur),
        'orders', (select count(*)::int from cur),
        'aov_minor', (select coalesce(round(avg(total_minor)), 0)::bigint from cur),
        'prev_revenue_minor', (select coalesce(sum(total_minor), 0)::bigint from prev),
        'prev_orders', (select count(*)::int from prev),
        'prev_aov_minor', (select coalesce(round(avg(total_minor)), 0)::bigint from prev),
        'today_revenue_minor', (select coalesce(sum(total_minor), 0)::bigint from cur where placed_at >= v_today_from),
        'units', (select coalesce(sum(quantity), 0)::int from items),
        'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'revenue_minor', revenue_minor, 'orders', orders) order by d), '[]'::jsonb) from daily),
        'payment_mix', (
          select coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'revenue_minor', coalesce(x.revenue_minor, 0), 'orders', coalesce(x.orders, 0)) order by m.ord), '[]'::jsonb)
          from (values ('cod', 1), ('sslcommerz', 2)) m(method, ord)
          left join (select payment_method, sum(total_minor)::bigint as revenue_minor, count(*)::int as orders from cur group by payment_method) x
            on x.payment_method = m.method),
        'cod_due_minor', (
          select coalesce(sum(o.total_minor), 0)::bigint from public.orders o
          where o.payment_method = 'cod' and o.payment_status = 'cod_pending' and o.shipment_status = 'delivered'),
        'cod_due_orders', (
          select count(*)::int from public.orders o
          where o.payment_method = 'cod' and o.payment_status = 'cod_pending' and o.shipment_status = 'delivered'),
        'top_products', (
          select coalesce(jsonb_agg(t order by t.revenue_minor desc, t.title), '[]'::jsonb) from (
            select product_title as title, sum(quantity)::int as units, sum(line_total_minor)::bigint as revenue_minor
            from items group by product_title order by sum(line_total_minor) desc, product_title limit 5) t),
        'by_category', (
          select coalesce(jsonb_agg(t order by t.revenue_minor desc, t.name), '[]'::jsonb) from (
            select coalesce(category, 'Uncategorised') as name, sum(line_total_minor)::bigint as revenue_minor, sum(quantity)::int as units
            from items group by coalesce(category, 'Uncategorised')) t)
      )
    ));
  end if;

  -- Orders ----------------------------------------------------------------
  if can_orders then
    result := result || jsonb_build_object('orders', (
      with w as (
        select o.*, (o.placed_at at time zone v_tz)::date as d
        from public.orders o where o.placed_at >= v_prev_from
      ),
      days as (select g::date as d from generate_series(v_start, v_today, interval '1 day') g),
      daily as (
        select days.d, count(w.id) filter (where w.placed_at >= v_from)::int as orders
        from days left join w on w.d = days.d group by days.d
      )
      select jsonb_build_object(
        'today', (select count(*)::int from w where placed_at >= v_today_from),
        'placed', (select count(*)::int from w where placed_at >= v_from),
        'prev_placed', (select count(*)::int from w where placed_at < v_from),
        'cancelled', (select count(*)::int from w where placed_at >= v_from and fulfillment_status = 'cancelled'),
        'delivered', (select count(*)::int from w where placed_at >= v_from and shipment_status = 'delivered'),
        'all_time', (select count(*)::int from public.orders),
        'demo', (select count(*)::int from public.orders where is_demo),
        'pipeline', (
          select jsonb_build_object(
            'to_confirm', count(*) filter (where fulfillment_status = 'unfulfilled' and shipment_status = 'not_shipped'),
            'processing', count(*) filter (where fulfillment_status in ('confirmed', 'picking', 'packed', 'partially_fulfilled') and shipment_status in ('not_shipped', 'ready_for_pickup')),
            'shipping', count(*) filter (where shipment_status in ('handed_to_courier', 'in_transit', 'out_for_delivery')),
            'problem', count(*) filter (where shipment_status in ('delivery_failed', 'rto')))
          from public.orders where fulfillment_status <> 'cancelled' and shipment_status not in ('delivered', 'returned')),
        'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'orders', orders) order by d), '[]'::jsonb) from daily),
        'open_leads', (select count(*)::int from public.checkout_leads where status = 'open'),
        'recent', (
          select coalesce(jsonb_agg(r order by r.placed_at desc), '[]'::jsonb) from (
            select o.id, o.order_number, o.customer_name, o.placed_at, o.payment_method, o.payment_status,
                   o.fulfillment_status, o.shipment_status, o.risk_review_status, o.is_demo,
                   (select count(*)::int from public.order_items oi where oi.order_id = o.id) as items,
                   case when can_sales then o.total_minor end as total_minor
            from public.orders o order by o.placed_at desc limit 8) r)
      )
    ));
  end if;

  -- Risk ------------------------------------------------------------------
  if can_risk then
    result := result || jsonb_build_object('risk', jsonb_build_object(
      'needs_review', (select count(*)::int from public.orders where risk_review_status = 'needs_review'),
      'high_open', (select count(*)::int from public.orders
                    where risk_level = 'high' and fulfillment_status <> 'cancelled' and shipment_status not in ('delivered', 'returned'))
    ));
  end if;

  -- Catalogue -------------------------------------------------------------
  if can_products then
    result := result || jsonb_build_object('catalog', jsonb_build_object(
      'active', (select count(*)::int from public.products where status = 'active'),
      'draft', (select count(*)::int from public.products where status = 'draft'),
      'archived', (select count(*)::int from public.products where status = 'archived'),
      'featured', (select count(*)::int from public.products where status = 'active' and featured),
      'tryon', (select count(*)::int from public.products where status = 'active' and tryon_enabled),
      'categories', (select count(*)::int from public.categories),
      'active_categories', (select count(*)::int from public.categories where is_active),
      'new_products', (select count(*)::int from public.products where created_at >= v_from),
      'by_category', (
        select coalesce(jsonb_agg(t order by t.products desc, t.name), '[]'::jsonb) from (
          select coalesce(c.name, 'Uncategorised') as name, count(*)::int as products
          from public.products p left join public.categories c on c.id = p.category_id
          where p.status = 'active'
          group by coalesce(c.name, 'Uncategorised')) t)
    ));
  end if;

  -- Inventory -------------------------------------------------------------
  if can_inventory then
    result := result || jsonb_build_object('inventory', (
      with per_variant as (
        select v.id, coalesce(sum(b.on_hand - b.reserved - b.damaged), 0) as available,
               coalesce(sum(b.on_hand), 0) as on_hand,
               coalesce(max(b.reorder_point), 3) as reorder_point
        from public.product_variants v
        join public.products p on p.id = v.product_id and p.status <> 'archived'
        left join public.stock_balances b on b.variant_id = v.id
        where v.is_active
        group by v.id
      )
      select jsonb_build_object(
        'skus', count(*)::int,
        'units_available', coalesce(sum(greatest(available, 0)), 0)::int,
        'units_on_hand', coalesce(sum(on_hand), 0)::int,
        'reserved', (select coalesce(sum(reserved), 0)::int from public.stock_balances),
        'low', count(*) filter (where available > 0 and available <= reorder_point)::int,
        'out', count(*) filter (where available <= 0)::int)
      from per_variant
    ));
  end if;

  -- Customers -------------------------------------------------------------
  if can_customers then
    result := result || jsonb_build_object('customers', (
      with c as (
        select p.id, p.created_at from public.profiles p
        where not exists (select 1 from public.staff_members sm where sm.user_id = p.id)
      )
      select jsonb_build_object(
        'total', (select count(*)::int from c),
        'new', (select count(*)::int from c where created_at >= v_from),
        'prev_new', (select count(*)::int from c where created_at >= v_prev_from and created_at < v_from),
        'buyers', case when can_orders then (
          select count(distinct customer_phone)::int from public.orders where fulfillment_status <> 'cancelled') end,
        'repeat_buyers', case when can_orders then (
          select count(*)::int from (
            select customer_phone from public.orders where fulfillment_status <> 'cancelled'
            group by customer_phone having count(*) > 1) r) end)
    ));
  end if;

  -- Reviews ---------------------------------------------------------------
  if can_reviews then
    result := result || jsonb_build_object('reviews', jsonb_build_object(
      'pending', (select count(*)::int from public.product_reviews where status = 'pending'),
      'approved', (select count(*)::int from public.product_reviews where status = 'approved'),
      'avg_rating', (select round(avg(rating)::numeric, 2) from public.product_reviews where status = 'approved')
    ));
  end if;

  -- Activity --------------------------------------------------------------
  if can_audit then
    result := result || jsonb_build_object('activity', (
      select coalesce(jsonb_agg(a order by a.occurred_at desc), '[]'::jsonb) from (
        select e.id, e.occurred_at, e.action, e.entity_type, e.actor_role,
               coalesce(sm.display_name, '') as actor_name
        from public.audit_events e
        left join public.staff_members sm on sm.user_id = e.actor_id
        order by e.occurred_at desc limit 8) a
    ));
  end if;

  return result;
end;
$$;

revoke all on function public.admin_dashboard_stats(int) from public, anon;
grant execute on function public.admin_dashboard_stats(int) to authenticated;
