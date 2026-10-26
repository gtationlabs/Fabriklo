-- =============================================================================
-- Fabriklo DEVELOPMENT seed. Every product here is flagged is_demo = true and is
-- shown with a "Demo product" label. Never run this against production.
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.environment', true), 'development') = 'production' then
    raise exception 'refusing to seed demo data into production';
  end if;
end $$;

insert into public.warehouses (code, name, is_default) values
  ('DHK-MAIN', 'Dhaka main store (demo)', true),
  ('DHK-WH2', 'Dhaka backroom (demo)', false);

insert into public.categories (slug, name, description, position) values
  ('t-shirts', 'T-Shirts', 'Everyday cotton tees.', 1),
  ('shirts', 'Shirts', 'Casual and formal shirts.', 2),
  ('pants', 'Pants', 'Chinos, trousers and joggers.', 3),
  ('polos', 'Polos', 'Pique and knit polos.', 4),
  ('outerwear', 'Outerwear', 'Jackets, hoodies and layers.', 5),
  ('accessories', 'Accessories', 'Caps, belts, socks and bags.', 6);

insert into public.collections (slug, name, description, published_at, position) values
  ('new-arrivals', 'New Arrivals', 'Fresh pieces this season (demo).', now(), 1),
  ('winter-layers', 'Winter Layers', 'Warm layers for cooler evenings (demo).', now(), 2),
  ('office-edit', 'The Office Edit', 'Sharp, easy workwear (demo).', now(), 3);

-- Demo catalogue: title, slug, category, audience, base price (BDT), sizes, colours
create temporary table seed_products (
  title text, slug text, category text, audience text, price_bdt int, compare_bdt int,
  sizes text[], colors text[], hexes text[], collections text[], featured boolean, subtitle text
);

insert into seed_products values
  ('Essential Crew Tee', 'essential-crew-tee', 't-shirts', 'men', 690, null, '{S,M,L,XL}', '{Charcoal,Cream,Espresso}', '{#36454F,#F3EBDD,#4B3621}', '{new-arrivals}', true, 'Soft combed cotton, regular fit'),
  ('Heavyweight Pocket Tee', 'heavyweight-pocket-tee', 't-shirts', 'men', 890, 1090, '{M,L,XL,XXL}', '{Black,Sand}', '{#111111,#C2B280}', '{new-arrivals}', false, '240 GSM cotton with chest pocket'),
  ('Relaxed Graphic Tee', 'relaxed-graphic-tee', 't-shirts', 'women', 790, null, '{XS,S,M,L}', '{Blush,White}', '{#E8B4B8,#FFFFFF}', '{new-arrivals}', true, 'Oversized fit with original print'),
  ('Ribbed Fitted Tee', 'ribbed-fitted-tee', 't-shirts', 'women', 650, null, '{XS,S,M,L}', '{Olive,Ivory,Black}', '{#708238,#FFFFF0,#111111}', '{}', false, 'Stretch rib, slim fit'),
  ('Oxford Button-Down Shirt', 'oxford-button-down-shirt', 'shirts', 'men', 1890, null, '{S,M,L,XL}', '{Sky Blue,White}', '{#87CEEB,#FFFFFF}', '{office-edit}', true, 'Classic oxford weave'),
  ('Checked Flannel Shirt', 'checked-flannel-shirt', 'shirts', 'men', 1690, 1990, '{M,L,XL}', '{Green Check,Navy Check}', '{#2F4F2F,#1F2A44}', '{winter-layers}', false, 'Brushed cotton flannel'),
  ('Linen Blend Shirt', 'linen-blend-shirt', 'shirts', 'women', 1790, null, '{XS,S,M,L}', '{Natural,Terracotta}', '{#E5D3B3,#C66A4A}', '{new-arrivals}', false, 'Breathable linen-cotton blend'),
  ('Poplin Tunic Shirt', 'poplin-tunic-shirt', 'shirts', 'women', 1590, null, '{S,M,L}', '{White,Bronze}', '{#FFFFFF,#9C6B30}', '{office-edit}', true, 'Crisp poplin, longline cut'),
  ('Slim Stretch Chino', 'slim-stretch-chino', 'pants', 'men', 1990, null, '{30,32,34,36}', '{Khaki,Navy,Charcoal}', '{#C3B091,#1F2A44,#36454F}', '{office-edit}', true, 'Stretch twill, slim tapered'),
  ('Herringbone Trouser', 'herringbone-trouser', 'pants', 'men', 2490, 2890, '{30,32,34,36}', '{Grey,Olive}', '{#808080,#556B2F}', '{winter-layers}', false, 'Textured herringbone weave'),
  ('Wide-Leg Trouser', 'wide-leg-trouser', 'pants', 'women', 2290, null, '{XS,S,M,L}', '{Espresso,Cream}', '{#4B3621,#F3EBDD}', '{office-edit}', false, 'High rise, fluid drape'),
  ('Everyday Jogger', 'everyday-jogger', 'pants', 'unisex', 1490, null, '{S,M,L,XL}', '{Heather Grey,Black}', '{#B6B6B4,#111111}', '{}', false, 'Brushed fleece interior'),
  ('Classic Pique Polo', 'classic-pique-polo', 'polos', 'men', 1290, null, '{S,M,L,XL}', '{Navy,White,Bottle Green}', '{#1F2A44,#FFFFFF,#006A4E}', '{new-arrivals}', true, 'Breathable cotton pique'),
  ('Knit Resort Polo', 'knit-resort-polo', 'polos', 'men', 1590, null, '{M,L,XL}', '{Camel,Black}', '{#C19A6B,#111111}', '{}', false, 'Open collar knit'),
  ('Cropped Polo Top', 'cropped-polo-top', 'polos', 'women', 1190, 1390, '{XS,S,M}', '{Sage,White}', '{#9CAF88,#FFFFFF}', '{new-arrivals}', false, 'Cropped fit, ribbed collar'),
  ('Long Sleeve Polo', 'long-sleeve-polo', 'polos', 'unisex', 1490, null, '{S,M,L,XL}', '{Charcoal,Burgundy}', '{#36454F,#800020}', '{winter-layers}', false, 'Fine-gauge long sleeve'),
  ('Quilted Bomber Jacket', 'quilted-bomber-jacket', 'outerwear', 'men', 3990, 4590, '{M,L,XL}', '{Black,Olive}', '{#111111,#556B2F}', '{winter-layers}', true, 'Light quilted fill'),
  ('Zip Hoodie', 'zip-hoodie', 'outerwear', 'unisex', 2290, null, '{S,M,L,XL}', '{Charcoal,Cream}', '{#36454F,#F3EBDD}', '{winter-layers}', false, 'Midweight brushed fleece'),
  ('Wool Blend Overshirt', 'wool-blend-overshirt', 'outerwear', 'men', 3290, null, '{M,L,XL}', '{Brown Check,Grey}', '{#6F4E37,#808080}', '{winter-layers}', false, 'Shirt-jacket in wool blend'),
  ('Belted Trench Coat', 'belted-trench-coat', 'outerwear', 'women', 4890, null, '{S,M,L}', '{Stone,Black}', '{#B9B4A6,#111111}', '{winter-layers}', true, 'Water-resistant cotton twill'),
  ('Canvas Baseball Cap', 'canvas-baseball-cap', 'accessories', 'unisex', 590, null, '{One Size}', '{Black,Khaki}', '{#111111,#C3B091}', '{}', false, 'Adjustable strap'),
  ('Leather Belt', 'leather-belt', 'accessories', 'men', 1190, null, '{32,34,36,38}', '{Brown,Black}', '{#6F4E37,#111111}', '{office-edit}', false, 'Full-grain leather'),
  ('Everyday Tote Bag', 'everyday-tote-bag', 'accessories', 'women', 990, null, '{One Size}', '{Natural,Espresso}', '{#E5D3B3,#4B3621}', '{new-arrivals}', false, 'Heavy canvas tote'),
  ('Cotton Crew Socks 3-Pack', 'cotton-crew-socks-3-pack', 'accessories', 'unisex', 450, null, '{One Size}', '{Mixed Neutrals}', '{#B6B6B4}', '{}', false, 'Combed cotton blend'),
  -- One draft product so tests can prove drafts never leak publicly.
  ('Unreleased Draft Jacket', 'unreleased-draft-jacket', 'outerwear', 'men', 5990, null, '{M,L}', '{Black}', '{#111111}', '{}', false, 'Draft: not for sale');

do $$
declare
  r record;
  v_product uuid;
  v_variant uuid;
  v_wh uuid;
  v_wh2 uuid;
  v_si int;
  v_ci int;
  v_qty int;
  v_n int := 0;
begin
  select id into v_wh from public.warehouses where code = 'DHK-MAIN';
  select id into v_wh2 from public.warehouses where code = 'DHK-WH2';

  for r in select * from seed_products loop
    v_n := v_n + 1;
    insert into public.products (slug, title, subtitle, description, materials, care, category_id, audience,
      status, published_at, featured, is_demo, tags, seo_title, seo_description)
    values (
      r.slug, r.title, r.subtitle,
      'Demo product for development. ' || r.subtitle || '. Designed for everyday wear in a warm climate.',
      'Demo material description', 'Machine wash cold. Do not bleach. Line dry in shade.',
      (select id from public.categories where slug = r.category), r.audience,
      case when r.slug = 'unreleased-draft-jacket' then 'draft' else 'active' end,
      case when r.slug = 'unreleased-draft-jacket' then null else now() - make_interval(days => v_n) end,
      r.featured, true, array[r.category, r.audience],
      left(r.title || ' | Fabriklo', 70), left(r.subtitle, 170))
    returning id into v_product;

    for v_ci in 1 .. cardinality(r.colors) loop
      for v_si in 1 .. cardinality(r.sizes) loop
        insert into public.product_variants (product_id, sku, size, color, color_hex, price_minor, compare_at_minor, position)
        values (v_product,
          upper(left(regexp_replace(r.slug, '[^a-z]', '', 'g'), 8)) || '-' ||
            upper(left(regexp_replace(r.colors[v_ci], '[^A-Za-z]', '', 'g'), 4)) || '-' ||
            upper(regexp_replace(r.sizes[v_si], '[^A-Za-z0-9]', '', 'g')),
          r.sizes[v_si], r.colors[v_ci], r.hexes[v_ci],
          r.price_bdt * 100, case when r.compare_bdt is not null then r.compare_bdt * 100 end,
          v_ci * 10 + v_si)
        returning id into v_variant;

        insert into public.variant_costs (variant_id, cost_minor) values (v_variant, (r.price_bdt * 45));

        -- Deterministic demo stock; some variants sold out, some low.
        v_qty := ((v_n * 7 + v_ci * 3 + v_si * 5) % 14);
        if v_qty > 0 then
          perform private.apply_stock_movement(v_variant, v_wh, 'receive', v_qty, 0,
            'Demo seed stock', 'seed', null, 'seed:' || v_variant::text);
        end if;
        if (v_n + v_si) % 4 = 0 then
          perform private.apply_stock_movement(v_variant, v_wh2, 'receive', 2, 0,
            'Demo seed stock (backroom)', 'seed', null, 'seed2:' || v_variant::text);
        end if;
      end loop;
    end loop;

    insert into public.collection_products (collection_id, product_id, position)
    select c.id, v_product, v_n from public.collections c where c.slug = any(r.collections);
  end loop;
end $$;

-- Hero tour using the owner's five store renders (see docs/3D_TOUR_ASSETS.md).
insert into public.hero_tours (key, renderer, status) values ('home', 'scroll-2.5d', 'published');

insert into public.hero_scenes (tour_id, position, image_path, image_alt, eyebrow, heading, body, cta_label, cta_href, object_position, zoom, parallax)
select t.id, s.position, s.image_path, s.image_alt, s.eyebrow, s.heading, s.body, s.cta_label, s.cta_href, s.object_position, s.zoom, s.parallax
from public.hero_tours t,
(values
  (1, '/assets/store/store-01.webp', 'Wide view of the store entrance: warm wooden ceiling, track lights, clothing racks on both sides and the checkout counter at the back.', 'Welcome in', 'Step inside the store', 'Scroll to walk through the showroom, or skip straight to the collection.', 'Explore the collection', '/shop', '50% 55%', 1.06, 0.04),
  (2, '/assets/store/store-02.webp', 'Left wall shelving with folded tees and hanging tops above a low display table, with fitting rooms in the background.', 'Tops and tees', 'Everyday layers, folded and ready', 'Soft cotton tees, knits and shirts in warm, easy colours.', 'Shop T-shirts', '/category/t-shirts', '40% 50%', 1.08, 0.05),
  (3, '/assets/store/store-03.webp', 'Right side racks with tailored trousers on a chrome rail and shirts on a wooden wall unit.', 'Trousers and shirts', 'Tailoring that moves with you', 'Chinos, herringbone trousers and checked shirts for work and weekend.', 'Shop pants', '/category/pants', '55% 55%', 1.08, 0.05),
  (4, '/assets/store/store-04.webp', 'The main checkout counter with three numbered service points and lettered wall art behind it.', 'Checkout', 'Easy checkout, cash on delivery', 'Pay on delivery or online, and follow your order from packing to doorstep.', 'How delivery works', '/shipping', '55% 50%', 1.06, 0.03),
  (5, '/assets/store/store-05.webp', 'Fitting rooms for women and men next to a rack of jackets, beside the service counter.', 'Fitting rooms', 'Try it on, even from home', 'Preview selected pieces on your own photo with AI try-on (coming soon).', 'Start shopping', '/shop', '45% 50%', 1.07, 0.04)
) as s(position, image_path, image_alt, eyebrow, heading, body, cta_label, cta_href, object_position, zoom, parallax)
where t.key = 'home';

insert into public.site_settings (key, value, is_public) values
  ('store.identity', '{"name": "Fabriklo", "tagline": "Considered clothing for everyday Dhaka", "currency": "BDT", "locale": "en-BD"}', true),
  ('store.contact', '{"email": "hello@example.com", "phone": "+8801700000000", "note": "Placeholder contact details (demo)"}', true),
  ('checkout.cod', '{"enabled": true, "max_order_minor": 2000000}', false);

-- Demo shipping zones. Fees are placeholders: staff set real rates in admin.
insert into public.shipping_zones (code, name, districts, is_fallback, fee_minor, free_over_minor, cod_enabled, estimate_min_days, estimate_max_days, position) values
  ('inside-dhaka', 'Inside Dhaka (demo rate)', array['Dhaka'], false, 7000, 500000, true, 1, 2, 1),
  ('outside-dhaka', 'Outside Dhaka (demo rate)', '{}', true, 13000, 800000, true, 2, 5, 2);
drop table if exists seed_products;
