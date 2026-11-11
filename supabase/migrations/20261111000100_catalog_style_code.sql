-- =============================================================================
-- Fabriklo 0017: listing cards show a style code (the SKU stem shared by a
-- product's variants), as on the redesigned catalogue pages. The return type
-- changes, so the function is dropped and recreated with the same grants.
-- =============================================================================

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
  style_code text,
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
             order by m.position, m.created_at limit 1) as image_alt,
           -- Style code shown on listing cards: the SKU stem shared by the product's variants.
           (select split_part(min(v4.sku), '-', 1) from public.product_variants v4
             where v4.product_id = p.id and v4.is_active) as style_code
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
