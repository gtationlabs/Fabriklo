-- =============================================================================
-- Fabriklo: admin dashboard modules
--
--   * checkout leads      details typed into checkout but never submitted
--   * home slides         promo banner slider under the hero (cms.edit)
--   * shipping methods    delivery options on top of zone fees (settings.manage)
--   * product reviews     customer reviews + staff moderation (reviews.moderate)
--   * customers           list + disable/enable (customers.read / customers.manage)
--   * staff profiles      own profile, avatar, language
--   * API keys            hashed keys for the read-only /api/v1 endpoints
--   * Meta pixels         pixel ids loaded on the storefront after consent
--   * settings keys       store.social, store.invoice, shipping.courier
--
-- Every table has RLS; writes are permission-checked in policies or definer
-- RPCs, and every staff change lands in the audit log.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New permission
-- -----------------------------------------------------------------------------
insert into public.permissions (code, description) values
  ('reviews.moderate', 'Approve, reject, reply to and import product reviews')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code)
select r.code, 'reviews.moderate' from public.staff_roles r
where r.code in ('super_admin', 'admin', 'store_manager', 'marketing_manager', 'content_editor', 'support_agent')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Public bucket for site imagery (slides) and staff avatars. The app validates
-- and re-encodes every upload (sharp → WebP, metadata stripped) before storing.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('site-media', 'site-media', true, 10485760, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "editors manage slide images" on storage.objects
  for all to authenticated
  using (bucket_id = 'site-media' and (storage.foldername(name))[1] = 'slides' and (select private.has_permission('cms.edit')))
  with check (bucket_id = 'site-media' and (storage.foldername(name))[1] = 'slides' and (select private.has_permission('cms.edit')));
create policy "staff manage own avatar" on storage.objects
  for all to authenticated
  using (bucket_id = 'site-media' and (storage.foldername(name))[1] = 'avatars'
         and (storage.foldername(name))[2] = (select auth.uid())::text and (select private.is_active_staff()))
  with check (bucket_id = 'site-media' and (storage.foldername(name))[1] = 'avatars'
         and (storage.foldername(name))[2] = (select auth.uid())::text and (select private.is_active_staff()));

-- =============================================================================
-- Checkout leads
-- =============================================================================
create table public.checkout_leads (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null unique references public.carts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null default '' check (char_length(name) <= 120),
  phone text not null check (phone ~ '^\+8801[3-9][0-9]{8}$'),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  district text check (district is null or char_length(district) <= 60),
  address_line text check (address_line is null or char_length(address_line) <= 300),
  items jsonb not null default '[]'::jsonb,
  item_count int not null default 0 check (item_count >= 0),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  status text not null default 'open' check (status in ('open', 'contacted', 'recovered', 'lost')),
  order_id uuid references public.orders(id) on delete set null,
  staff_note text check (staff_note is null or char_length(staff_note) <= 500),
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index checkout_leads_status_idx on public.checkout_leads(status, updated_at desc);
create trigger checkout_leads_updated_at before update on public.checkout_leads
  for each row execute function private.set_updated_at();

alter table public.checkout_leads enable row level security;
grant select, delete on public.checkout_leads to authenticated;
grant update (status, staff_note, contacted_at) on public.checkout_leads to authenticated;
create policy "order staff read leads" on public.checkout_leads
  for select to authenticated using ((select private.has_permission('orders.read')));
create policy "fulfilment staff update leads" on public.checkout_leads
  for update to authenticated
  using ((select private.has_permission('orders.fulfill')))
  with check ((select private.has_permission('orders.fulfill')));
create policy "customer managers delete leads" on public.checkout_leads
  for delete to authenticated using ((select private.has_permission('customers.manage')));
create trigger checkout_leads_audit after update or delete on public.checkout_leads
  for each row execute function private.audit_row_change();

-- Called by the checkout page (debounced) once a valid phone number is typed.
-- Keyed by the cart, so a shopper has one lead however often they edit.
create or replace function public.capture_checkout_lead(p_cart_token text, p_lead jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
  v_phone text := btrim(coalesce(p_lead ->> 'phone', ''));
  v_email text := nullif(lower(btrim(coalesce(p_lead ->> 'email', ''))), '');
  v_items jsonb;
  v_count int;
  v_subtotal bigint;
begin
  if p_lead is null or jsonb_typeof(p_lead) <> 'object' or char_length(p_lead::text) > 2000 then
    raise exception 'invalid lead' using errcode = '22023';
  end if;
  if v_phone !~ '^\+8801[3-9][0-9]{8}$' then
    raise exception 'a valid Bangladesh mobile number is required' using errcode = '22023', hint = 'invalid_phone';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+$') then
    v_email := null;
  end if;
  v_cart := private.cart_by_token(p_cart_token);
  if v_cart.id is null or v_cart.status <> 'active' then
    return false;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('title', p.title, 'size', v.size, 'color', v.color, 'quantity', ci.quantity,
                                               'unit_price_minor', v.price_minor) order by ci.added_at), '[]'::jsonb),
         coalesce(sum(ci.quantity), 0), coalesce(sum(v.price_minor * ci.quantity), 0)
    into v_items, v_count, v_subtotal
  from public.cart_items ci
  join public.product_variants v on v.id = ci.variant_id
  join public.products p on p.id = v.product_id
  where ci.cart_id = v_cart.id;
  if v_count = 0 then
    return false;
  end if;

  insert into public.checkout_leads (cart_id, user_id, name, phone, email, district, address_line, items, item_count, subtotal_minor)
  values (v_cart.id, coalesce(v_cart.user_id, (select auth.uid())),
          left(btrim(regexp_replace(coalesce(p_lead ->> 'name', ''), '[<>]', '', 'g')), 120), v_phone, v_email,
          nullif(left(btrim(coalesce(p_lead ->> 'district', '')), 60), ''),
          nullif(left(btrim(regexp_replace(coalesce(p_lead ->> 'address_line', ''), '[<>]', '', 'g')), 300), ''),
          v_items, v_count, v_subtotal)
  on conflict (cart_id) do update set
    name = excluded.name, phone = excluded.phone, email = excluded.email, district = excluded.district,
    address_line = excluded.address_line, items = excluded.items, item_count = excluded.item_count,
    subtotal_minor = excluded.subtotal_minor, user_id = coalesce(public.checkout_leads.user_id, excluded.user_id)
  where public.checkout_leads.status in ('open', 'contacted');
  return true;
end;
$$;
revoke all on function public.capture_checkout_lead(text, jsonb) from public;
grant execute on function public.capture_checkout_lead(text, jsonb) to anon, authenticated;

-- An order placed from the same cart closes the lead as recovered.
create or replace function private.close_checkout_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cart_id is not null then
    update public.checkout_leads set status = 'recovered', order_id = new.id
    where cart_id = new.cart_id and status <> 'recovered';
  end if;
  return new;
end;
$$;
revoke all on function private.close_checkout_lead() from public;
create trigger orders_close_checkout_lead after insert on public.orders
  for each row execute function private.close_checkout_lead();

-- Leads are personal data captured before consent to an order: keep them 90 days.
create or replace function private.purge_old_checkout_leads()
returns int
language sql
security definer
set search_path = ''
as $$
  with d as (delete from public.checkout_leads where updated_at < now() - interval '90 days' returning 1)
  select count(*)::int from d;
$$;
revoke all on function private.purge_old_checkout_leads() from public;
select cron.schedule('purge-checkout-leads', '17 3 * * *', 'select private.purge_old_checkout_leads()');

-- =============================================================================
-- Home slides
-- =============================================================================
create table public.home_slides (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80 and title !~ '[<>]'),
  subtitle text not null default '' check (char_length(subtitle) <= 160 and subtitle !~ '[<>]'),
  eyebrow text not null default '' check (char_length(eyebrow) <= 40 and eyebrow !~ '[<>]'),
  image_path text check (image_path is null or image_path ~ '^slides/[A-Za-z0-9/_.-]{1,200}$'),
  image_alt text not null default '' check (char_length(image_alt) <= 160 and image_alt !~ '[<>]'),
  link_url text check (link_url is null or link_url ~ '^/[A-Za-z0-9/_.?=&%#-]{0,250}$' or link_url ~ '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9/_.?=&%#-]{0,250})?$'),
  cta_label text not null default '' check (char_length(cta_label) <= 30 and cta_label !~ '[<>]'),
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  position int not null default 0,
  is_active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index home_slides_position_idx on public.home_slides(position);
create trigger home_slides_updated_at before update on public.home_slides
  for each row execute function private.set_updated_at();
alter table public.home_slides enable row level security;
grant select on public.home_slides to anon, authenticated;
grant insert, update, delete on public.home_slides to authenticated;
create policy "public read live slides" on public.home_slides
  for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy "editors read slides" on public.home_slides
  for select to authenticated using ((select private.has_permission('cms.edit')));
create policy "editors write slides" on public.home_slides
  for insert to authenticated
  with check ((select private.has_permission('cms.edit')) and (not is_active or (select private.has_permission('cms.publish'))));
create policy "editors update slides" on public.home_slides
  for update to authenticated
  using ((select private.has_permission('cms.edit')))
  with check ((select private.has_permission('cms.edit')) and (not is_active or (select private.has_permission('cms.publish'))));
create policy "editors delete slides" on public.home_slides
  for delete to authenticated using ((select private.has_permission('cms.edit')));
create trigger home_slides_audit after insert or update or delete on public.home_slides
  for each row execute function private.audit_row_change();

-- =============================================================================
-- Shipping methods (an adjustment on top of the zone fee)
-- =============================================================================
create table public.shipping_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 2 and 60 and name !~ '[<>]'),
  description text not null default '' check (char_length(description) <= 200 and description !~ '[<>]'),
  fee_adjust_minor bigint not null default 0 check (fee_adjust_minor between 0 and 10000000),
  estimate_min_days int check (estimate_min_days is null or estimate_min_days between 0 and 60),
  estimate_max_days int check (estimate_max_days is null or estimate_max_days between 0 and 60),
  cod_allowed boolean not null default true,
  is_default boolean not null default false,
  is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (estimate_max_days is null or estimate_min_days is null or estimate_max_days >= estimate_min_days),
  check (not is_default or is_active)
);
create unique index shipping_methods_one_default on public.shipping_methods((true)) where is_default;
create trigger shipping_methods_updated_at before update on public.shipping_methods
  for each row execute function private.set_updated_at();
alter table public.shipping_methods enable row level security;
grant select on public.shipping_methods to anon, authenticated;
grant insert, update, delete on public.shipping_methods to authenticated;
create policy "public read active methods" on public.shipping_methods
  for select to anon, authenticated using (is_active);
create policy "settings managers read methods" on public.shipping_methods
  for select to authenticated using ((select private.has_permission('settings.manage')));
create policy "settings managers write methods" on public.shipping_methods
  for all to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));
create trigger shipping_methods_audit after insert or update or delete on public.shipping_methods
  for each row execute function private.audit_row_change();

insert into public.shipping_methods (code, name, description, fee_adjust_minor, is_default, is_active, position) values
  ('standard', 'Standard delivery', 'Delivered by our courier partner within the zone estimate.', 0, true, true, 0),
  ('express', 'Express delivery', 'Placeholder: enter your real express surcharge before enabling.', 10000, false, false, 1)
on conflict (code) do nothing;

alter table public.carts add column shipping_method_id uuid references public.shipping_methods(id) on delete set null;
alter table public.orders add column shipping_method_code text check (shipping_method_code is null or shipping_method_code ~ '^[a-z0-9_-]{2,40}$');

-- The method a cart ships with: its own pick if still active, else the default.
create or replace function private.cart_shipping_method(p_cart_id uuid)
returns public.shipping_methods
language sql
stable
security definer
set search_path = ''
as $$
  select m.* from public.shipping_methods m
  where m.is_active and (m.id = (select c.shipping_method_id from public.carts c where c.id = p_cart_id) or m.is_default)
  order by (m.id = (select c.shipping_method_id from public.carts c where c.id = p_cart_id)) desc, m.position
  limit 1;
$$;
revoke all on function private.cart_shipping_method(uuid) from public;

create or replace function public.checkout_set_shipping_method(p_cart_token text, p_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cart public.carts;
  v_method uuid;
begin
  v_cart := private.cart_by_token(p_cart_token);
  if v_cart.id is null or v_cart.status <> 'active' then
    return false;
  end if;
  select id into v_method from public.shipping_methods where code = p_code and is_active;
  if v_method is null then
    raise exception 'that delivery option is not available' using errcode = '22023', hint = 'invalid_method';
  end if;
  update public.carts set shipping_method_id = v_method where id = v_cart.id;
  return true;
end;
$$;
revoke all on function public.checkout_set_shipping_method(text, text) from public;
grant execute on function public.checkout_set_shipping_method(text, text) to anon, authenticated;

-- Record the method on the order from the cart it was placed from.
create or replace function private.order_shipping_method()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cart_id is not null and new.shipping_method_code is null then
    new.shipping_method_code := (private.cart_shipping_method(new.cart_id)).code;
  end if;
  return new;
end;
$$;
revoke all on function private.order_shipping_method() from public;
create trigger orders_shipping_method before insert on public.orders
  for each row execute function private.order_shipping_method();

-- Quote, now including the shipping method's adjustment and the options list.
-- Same signature as before, so create_order picks it up unchanged.
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
  v_method public.shipping_methods;
  v_fee bigint;
  v_issues jsonb;
  v_cod jsonb;
  v_code text;
  v_promo jsonb;
  v_discount bigint;
  v_total bigint;
  v_methods jsonb;
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
  v_method := private.cart_shipping_method(p_cart_id);
  -- Free shipping (promotion or zone threshold) waives the zone fee; a paid
  -- upgrade such as express is still charged.
  v_fee := case when v_zone.id is null then null
                when (v_promo ->> 'free_shipping')::boolean then 0
                when v_zone.free_over_minor is not null and v_subtotal >= v_zone.free_over_minor then 0
                else v_zone.fee_minor end;
  if v_fee is not null then
    v_fee := v_fee + coalesce(v_method.fee_adjust_minor, 0);
  end if;
  v_total := case when v_fee is null then null else v_subtotal - v_discount + v_fee end;
  select value into v_cod from public.site_settings where key = 'checkout.cod';
  select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'description', m.description,
            'fee_adjust_minor', m.fee_adjust_minor, 'min_days', m.estimate_min_days, 'max_days', m.estimate_max_days,
            'cod_allowed', m.cod_allowed) order by m.position, m.name), '[]'::jsonb)
    into v_methods
  from public.shipping_methods m where m.is_active;

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
        'code', v_zone.code, 'name', v_zone.name,
        'min_days', coalesce(v_method.estimate_min_days, v_zone.estimate_min_days),
        'max_days', coalesce(v_method.estimate_max_days, v_zone.estimate_max_days)) end,
    'shipping_method', case when v_method.id is null then null else v_method.code end,
    'shipping_methods', v_methods,
    'district_known', p_district is null or exists (select 1 from public.bd_districts d where d.district = p_district),
    'cod_available', v_zone.id is not null and v_zone.cod_enabled
        and coalesce(v_method.cod_allowed, true)
        and coalesce((v_cod ->> 'enabled')::boolean, false)
        and coalesce(v_total, v_subtotal - v_discount) <= coalesce((v_cod ->> 'max_order_minor')::bigint, 0),
    'cod_max_order_minor', (v_cod ->> 'max_order_minor')::bigint
  );
end;
$$;
revoke all on function private.quote_cart(uuid, text, text, text) from public;

-- =============================================================================
-- Product reviews
-- =============================================================================
create table public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  author_name text not null check (char_length(btrim(author_name)) between 1 and 60 and author_name !~ '[<>]'),
  author_city text not null default '' check (char_length(author_city) <= 40 and author_city !~ '[<>]'),
  rating smallint not null check (rating between 1 and 5),
  fit text check (fit is null or fit in ('true', 'small', 'large')),
  size_bought text check (size_bought is null or (char_length(size_bought) <= 20 and size_bought !~ '[<>]')),
  title text not null default '' check (char_length(title) <= 120 and title !~ '[<>]'),
  body text not null check (char_length(btrim(body)) between 10 and 2000 and body !~ '[<>]'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source text not null default 'customer' check (source in ('customer', 'imported')),
  verified_purchase boolean not null default false,
  is_featured boolean not null default false,
  staff_reply text check (staff_reply is null or (char_length(staff_reply) <= 1000 and staff_reply !~ '[<>]')),
  replied_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_featured or status = 'approved')
);
create unique index product_reviews_one_per_customer on public.product_reviews(product_id, user_id) where user_id is not null;
create index product_reviews_product_idx on public.product_reviews(product_id, status, created_at desc);
create index product_reviews_status_idx on public.product_reviews(status, created_at desc);
create trigger product_reviews_updated_at before update on public.product_reviews
  for each row execute function private.set_updated_at();
alter table public.product_reviews enable row level security;
-- No anon access to the table: the public reads go through the RPCs below,
-- which leave out user ids.
grant select, insert, update, delete on public.product_reviews to authenticated;
create policy "moderators read reviews" on public.product_reviews
  for select to authenticated using ((select private.has_permission('reviews.moderate')));
create policy "customers read own reviews" on public.product_reviews
  for select to authenticated using (user_id = (select auth.uid()));
create policy "moderators import reviews" on public.product_reviews
  for insert to authenticated
  with check ((select private.has_permission('reviews.moderate')) and source = 'imported' and user_id is null);
create policy "moderators update reviews" on public.product_reviews
  for update to authenticated
  using ((select private.has_permission('reviews.moderate')))
  with check ((select private.has_permission('reviews.moderate')));
create policy "moderators delete reviews" on public.product_reviews
  for delete to authenticated using ((select private.has_permission('reviews.moderate')));
create trigger product_reviews_audit after update or delete on public.product_reviews
  for each row execute function private.audit_row_change();

create or replace function public.submit_product_review(p_product_id uuid, p_rating int, p_title text, p_body text, p_author_name text,
                                                         p_fit text default null, p_size text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_verified boolean;
begin
  if v_uid is null then
    raise exception 'sign in to write a review' using errcode = '42501', hint = 'sign_in';
  end if;
  if not private.product_is_public(p_product_id) then
    raise exception 'product not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  if exists (select 1 from public.profiles pr where pr.id = v_uid and pr.is_disabled) then
    raise exception 'account disabled' using errcode = '42501', hint = 'disabled';
  end if;
  if exists (select 1 from public.product_reviews r where r.product_id = p_product_id and r.user_id = v_uid) then
    raise exception 'you already reviewed this product' using errcode = '23505', hint = 'duplicate';
  end if;
  select exists (
    select 1 from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.product_variants v on v.id = oi.variant_id
    where o.user_id = v_uid and v.product_id = p_product_id and o.fulfillment_status = 'delivered'
  ) into v_verified;
  insert into public.product_reviews (product_id, user_id, author_name, rating, title, body, verified_purchase, fit, size_bought)
  values (p_product_id, v_uid, btrim(p_author_name), p_rating, btrim(coalesce(p_title, '')), btrim(p_body), v_verified,
          nullif(p_fit, ''), nullif(btrim(coalesce(p_size, '')), ''));
  return 'pending';
end;
$$;
revoke all on function public.submit_product_review(uuid, int, text, text, text, text, text) from public;
grant execute on function public.submit_product_review(uuid, int, text, text, text, text, text) to authenticated;

create or replace function public.product_reviews_public(p_product_id uuid, p_limit int default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'count', (select count(*) from public.product_reviews where product_id = p_product_id and status = 'approved'),
    'average', (select round(avg(rating)::numeric, 1) from public.product_reviews where product_id = p_product_id and status = 'approved'),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'author_name', r.author_name, 'author_city', r.author_city, 'rating', r.rating,
               'title', r.title, 'body', r.body, 'verified_purchase', r.verified_purchase, 'staff_reply', r.staff_reply,
               'fit', r.fit, 'size_bought', r.size_bought,
               'created_at', r.created_at) order by r.created_at desc)
      from (select * from public.product_reviews where product_id = p_product_id and status = 'approved'
            order by created_at desc limit least(greatest(p_limit, 1), 50)) r), '[]'::jsonb));
$$;
revoke all on function public.product_reviews_public(uuid, int) from public;
grant execute on function public.product_reviews_public(uuid, int) to anon, authenticated;

create or replace function public.featured_reviews(p_limit int default 12)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'author_name', r.author_name, 'author_city', r.author_city,
           'rating', r.rating, 'title', r.title, 'body', r.body, 'verified_purchase', r.verified_purchase,
           'fit', r.fit, 'size_bought', r.size_bought, 'product_title', p.title, 'product_slug', p.slug, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
  from (select * from public.product_reviews where status = 'approved' and is_featured
        order by created_at desc limit least(greatest(p_limit, 1), 24)) r
  join public.products p on p.id = r.product_id
  where private.product_is_public(p.id);
$$;
revoke all on function public.featured_reviews(int) from public;
grant execute on function public.featured_reviews(int) to anon, authenticated;

-- =============================================================================
-- Customers
-- =============================================================================
create or replace function public.admin_list_customers(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, email text, full_name text, phone text, is_disabled boolean, is_staff boolean,
               created_at timestamptz, last_sign_in_at timestamptz, order_count bigint, spent_minor bigint, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not private.has_permission('customers.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  with base as (
    select u.id, u.email::text as email, coalesce(pr.full_name, '') as full_name, pr.phone, coalesce(pr.is_disabled, false) as is_disabled,
           exists (select 1 from public.staff_members sm where sm.user_id = u.id) as is_staff,
           u.created_at, u.last_sign_in_at
    from auth.users u
    left join public.profiles pr on pr.id = u.id
    where v_q is null
       or u.email ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
       or pr.full_name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
       or pr.phone like '%' || regexp_replace(v_q, '[^0-9]', '', 'g') || '%' and char_length(regexp_replace(v_q, '[^0-9]', '', 'g')) >= 4
  )
  select b.id, b.email, b.full_name, b.phone, b.is_disabled, b.is_staff, b.created_at, b.last_sign_in_at,
         (select count(*) from public.orders o where o.user_id = b.id),
         (select coalesce(sum(o.total_minor), 0)::bigint from public.orders o where o.user_id = b.id and o.fulfillment_status <> 'cancelled'),
         count(*) over ()
  from base b
  order by b.created_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;
revoke all on function public.admin_list_customers(text, int, int) from public;
grant execute on function public.admin_list_customers(text, int, int) to authenticated;

create or replace function public.admin_set_customer_disabled(p_user_id uuid, p_disabled boolean, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before boolean;
begin
  if not private.has_permission('customers.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.staff_members where user_id = p_user_id) then
    raise exception 'staff accounts are managed on the Staff page' using errcode = '22023', hint = 'is_staff';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception 'give a reason (3 to 300 characters)' using errcode = '22023', hint = 'reason';
  end if;
  select is_disabled into v_before from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  update public.profiles set is_disabled = p_disabled where id = p_user_id;
  perform private.write_audit(case when p_disabled then 'customer.disable' else 'customer.enable' end, 'profiles', p_user_id::text,
    jsonb_build_object('is_disabled', v_before), jsonb_build_object('is_disabled', p_disabled), btrim(p_reason));
end;
$$;
revoke all on function public.admin_set_customer_disabled(uuid, boolean, text) from public;
grant execute on function public.admin_set_customer_disabled(uuid, boolean, text) to authenticated;

-- =============================================================================
-- Staff profiles
-- =============================================================================
create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120 and full_name !~ '[<>]'),
  job_title text not null default '' check (char_length(job_title) <= 80 and job_title !~ '[<>]'),
  phone text check (phone is null or phone ~ '^\+8801[3-9][0-9]{8}$'),
  language text not null default 'en' check (language in ('en', 'bn')),
  avatar_path text check (avatar_path is null or avatar_path ~ '^avatars/[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,80}$'),
  show_on_invoices boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger staff_profiles_updated_at before update on public.staff_profiles
  for each row execute function private.set_updated_at();
alter table public.staff_profiles enable row level security;
grant select on public.staff_profiles to authenticated;
create policy "staff read staff profiles" on public.staff_profiles
  for select to authenticated using ((select private.is_active_staff()));

create or replace function public.staff_save_my_profile(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_display text := btrim(coalesce(p ->> 'display_name', ''));
  v_before jsonb;
begin
  if not private.is_active_staff() or not private.is_mfa_verified() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_display) not between 2 and 60 or v_display ~ '[<>]' then
    raise exception 'display name must be 2 to 60 characters' using errcode = '22023', hint = 'display_name';
  end if;
  select to_jsonb(sp) into v_before from public.staff_profiles sp where sp.user_id = v_uid;
  update public.staff_members set display_name = v_display where user_id = v_uid;
  insert into public.staff_profiles (user_id, full_name, job_title, phone, language, avatar_path, show_on_invoices)
  values (v_uid, btrim(coalesce(p ->> 'full_name', '')), btrim(coalesce(p ->> 'job_title', '')),
          nullif(btrim(coalesce(p ->> 'phone', '')), ''), coalesce(p ->> 'language', 'en'),
          case when p ? 'avatar_path' then nullif(p ->> 'avatar_path', '') else (select avatar_path from public.staff_profiles where user_id = v_uid) end,
          coalesce((p ->> 'show_on_invoices')::boolean, false))
  on conflict (user_id) do update set
    full_name = excluded.full_name, job_title = excluded.job_title, phone = excluded.phone,
    language = excluded.language, avatar_path = excluded.avatar_path, show_on_invoices = excluded.show_on_invoices;
  if p ? 'avatar_path' and nullif(p ->> 'avatar_path', '') is not null
     and (p ->> 'avatar_path') not like 'avatars/' || v_uid::text || '/%' then
    raise exception 'invalid avatar' using errcode = '22023';
  end if;
  perform private.write_audit('staff.profile_update', 'staff_profiles', v_uid::text, v_before,
    (select to_jsonb(sp) from public.staff_profiles sp where sp.user_id = v_uid), null);
end;
$$;
revoke all on function public.staff_save_my_profile(jsonb) from public;
grant execute on function public.staff_save_my_profile(jsonb) to authenticated;

-- =============================================================================
-- API keys (hash only; the key is shown once at creation)
-- =============================================================================
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60 and name !~ '[<>]'),
  prefix text not null check (prefix ~ '^fbk_[A-Za-z0-9_-]{4,12}$'),
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 4 and scopes <@ array['products.read', 'orders.read', 'inventory.read']),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
alter table public.api_keys enable row level security;
grant select on public.api_keys to authenticated;
grant insert on public.api_keys to authenticated;
grant update (revoked_at) on public.api_keys to authenticated;
create policy "integration readers read keys" on public.api_keys
  for select to authenticated using ((select private.has_permission('integrations.read')));
create policy "integration managers create keys" on public.api_keys
  for insert to authenticated with check ((select private.has_permission('integrations.manage')) and revoked_at is null);
create policy "integration managers revoke keys" on public.api_keys
  for update to authenticated
  using ((select private.has_permission('integrations.manage')) and revoked_at is null)
  with check ((select private.has_permission('integrations.manage')) and revoked_at is not null);
create trigger api_keys_audit after insert or update on public.api_keys
  for each row execute function private.audit_row_change();

-- =============================================================================
-- Meta pixels (public ids only; nothing secret)
-- =============================================================================
create table public.meta_pixels (
  id uuid primary key default gen_random_uuid(),
  pixel_id text not null unique check (pixel_id ~ '^[0-9]{8,20}$'),
  name text not null check (char_length(btrim(name)) between 2 and 60 and name !~ '[<>]'),
  is_active boolean not null default true,
  notes text not null default '' check (char_length(notes) <= 300 and notes !~ '[<>]'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger meta_pixels_updated_at before update on public.meta_pixels
  for each row execute function private.set_updated_at();
alter table public.meta_pixels enable row level security;
grant select, insert, update, delete on public.meta_pixels to authenticated;
create policy "integration readers read pixels" on public.meta_pixels
  for select to authenticated using ((select private.has_permission('integrations.read')));
create policy "integration managers write pixels" on public.meta_pixels
  for all to authenticated
  using ((select private.has_permission('integrations.manage')))
  with check ((select private.has_permission('integrations.manage')));
create trigger meta_pixels_audit after insert or update or delete on public.meta_pixels
  for each row execute function private.audit_row_change();

create or replace function public.active_meta_pixel_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(pixel_id order by created_at), '{}') from (
    select pixel_id, created_at from public.meta_pixels where is_active order by created_at limit 5) p;
$$;
revoke all on function public.active_meta_pixel_ids() from public;
grant execute on function public.active_meta_pixel_ids() to anon, authenticated;

-- =============================================================================
-- More settings keys. The original validator handles the old keys.
-- =============================================================================
alter function private.validate_site_setting(text, jsonb) rename to validate_site_setting_base;

create or replace function private.validate_site_setting(p_key text, p_value jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'setting must be an object' using errcode = '22023';
  end if;
  if p_key = 'store.social' then
    for k, v in select key, value from jsonb_each_text(p_value) loop
      if k not in ('facebook', 'instagram', 'tiktok', 'youtube', 'whatsapp') then
        raise exception 'unknown social field' using errcode = '22023';
      end if;
      if k = 'whatsapp' then
        if v <> '' and v !~ '^\+8801[3-9][0-9]{8}$' then
          raise exception 'WhatsApp number must look like +8801XXXXXXXXX' using errcode = '22023', hint = k;
        end if;
      elsif v <> '' and v !~ '^https://([a-z0-9-]+\.)*(facebook\.com|fb\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be)/[A-Za-z0-9._/@?=&%-]{0,200}$' then
        raise exception '% link must be an https link to that site', k using errcode = '22023', hint = k;
      end if;
    end loop;
  elsif p_key = 'store.invoice' then
    if exists (select 1 from jsonb_object_keys(p_value) x where x not in ('legal_name', 'bin', 'header_note', 'footer_note', 'return_policy', 'show_sku', 'packing_slip_prices')) then
      raise exception 'unknown invoice field' using errcode = '22023';
    end if;
    if char_length(coalesce(p_value ->> 'legal_name', '')) > 120 or char_length(coalesce(p_value ->> 'header_note', '')) > 200
       or char_length(coalesce(p_value ->> 'footer_note', '')) > 300 or char_length(coalesce(p_value ->> 'return_policy', '')) > 600 then
      raise exception 'invoice text is too long' using errcode = '22023';
    end if;
    if coalesce(p_value ->> 'bin', '') !~ '^([0-9]{9,13})?$' then
      raise exception 'BIN must be 9 to 13 digits' using errcode = '22023', hint = 'bin';
    end if;
    if jsonb_typeof(p_value -> 'show_sku') <> 'boolean' or jsonb_typeof(p_value -> 'packing_slip_prices') <> 'boolean' then
      raise exception 'invoice switches must be true or false' using errcode = '22023';
    end if;
    if (p_value::text) ~ '[<>]' then
      raise exception 'invoice text cannot contain angle brackets' using errcode = '22023';
    end if;
  elsif p_key = 'shipping.courier' then
    if exists (select 1 from jsonb_object_keys(p_value) x where x not in ('default_courier', 'pickup_name', 'pickup_phone', 'pickup_address', 'parcel_note')) then
      raise exception 'unknown courier field' using errcode = '22023';
    end if;
    if coalesce(p_value ->> 'default_courier', '') not in ('manual', 'pathao', 'steadfast', 'redx') then
      raise exception 'unknown courier' using errcode = '22023', hint = 'default_courier';
    end if;
    if coalesce(p_value ->> 'pickup_phone', '') !~ '^(\+8801[3-9][0-9]{8})?$' then
      raise exception 'pickup phone must look like +8801XXXXXXXXX' using errcode = '22023', hint = 'pickup_phone';
    end if;
    if char_length(coalesce(p_value ->> 'pickup_name', '')) > 80 or char_length(coalesce(p_value ->> 'pickup_address', '')) > 200
       or char_length(coalesce(p_value ->> 'parcel_note', '')) > 120 or (p_value::text) ~ '[<>]' then
      raise exception 'courier text is too long or has angle brackets' using errcode = '22023';
    end if;
  else
    perform private.validate_site_setting_base(p_key, p_value);
  end if;
end;
$$;
revoke all on function private.validate_site_setting(text, jsonb) from public;

create or replace function public.admin_update_site_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_public boolean;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform private.validate_site_setting(p_key, p_value);
  v_public := p_key in ('store.identity', 'store.contact', 'store.social');
  select value into v_old from public.site_settings where key = p_key for update;
  insert into public.site_settings (key, value, is_public, updated_by) values (p_key, p_value, v_public, (select auth.uid()))
  on conflict (key) do update set value = excluded.value, is_public = excluded.is_public, updated_by = excluded.updated_by;
  perform private.write_audit('settings.update', 'site_settings', p_key, v_old, p_value, null);
  return p_value;
end;
$$;
revoke all on function public.admin_update_site_setting(text, jsonb) from public;
grant execute on function public.admin_update_site_setting(text, jsonb) to authenticated;

insert into public.site_settings (key, value, is_public) values
  ('store.social', '{"facebook": "", "instagram": "", "tiktok": "", "youtube": "", "whatsapp": ""}', true),
  ('store.invoice', '{"legal_name": "", "bin": "", "header_note": "", "footer_note": "Thank you for shopping with us.", "return_policy": "", "show_sku": true, "packing_slip_prices": false}', false),
  ('shipping.courier', '{"default_courier": "manual", "pickup_name": "", "pickup_phone": "", "pickup_address": "", "parcel_note": ""}', false)
on conflict (key) do nothing;

-- Order staff print invoices / packing slips and book shipments: they read
-- these two (non-secret) settings without needing settings.manage.
create policy "order staff read invoice and courier settings" on public.site_settings
  for select to authenticated
  using (key in ('store.invoice', 'shipping.courier') and (select private.has_permission('orders.read')));

-- Staff record their own security events (password change, signing out other devices).
create or replace function public.staff_record_own_security_event(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_action not in ('staff.password_change', 'staff.sign_out_others') then
    raise exception 'unknown security event' using errcode = '22023';
  end if;
  perform private.write_audit(p_action, 'staff_members', (select auth.uid())::text, null, null, null);
end;
$$;
revoke all on function public.staff_record_own_security_event(text) from public;
grant execute on function public.staff_record_own_security_event(text) to authenticated;

-- =============================================================================
-- Read-only API (/api/v1/*). The app hashes the bearer key (SHA-256) and calls
-- this with the hash; nothing else about the key is ever sent or stored.
-- =============================================================================
create or replace function public.api_v1_read(p_key_hash text, p_resource text, p_since timestamptz default null, p_limit int default 100)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys;
  v_scope text := case p_resource when 'products' then 'products.read' when 'orders' then 'orders.read' when 'inventory' then 'inventory.read' end;
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if v_scope is null then
    raise exception 'unknown resource' using errcode = '22023', hint = 'not_found';
  end if;
  select * into v_key from public.api_keys
  where key_hash = p_key_hash and revoked_at is null and (expires_at is null or expires_at > now());
  if v_key.id is null then
    raise exception 'invalid api key' using errcode = '42501', hint = 'unauthorized';
  end if;
  if not (v_scope = any (v_key.scopes)) then
    raise exception 'key lacks scope %', v_scope using errcode = '42501', hint = 'forbidden';
  end if;
  if v_key.last_used_at is null or v_key.last_used_at < now() - interval '1 minute' then
    update public.api_keys set last_used_at = now() where id = v_key.id;
  end if;

  if p_resource = 'products' then
    return coalesce((select jsonb_agg(x order by x ->> 'updated_at' desc) from (
      select jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title, 'status', p.status,
        'updated_at', p.updated_at,
        'variants', coalesce((select jsonb_agg(jsonb_build_object('sku', v.sku, 'size', v.size, 'color', v.color,
                     'price_minor', v.price_minor, 'is_active', v.is_active) order by v.sku) from public.product_variants v where v.product_id = p.id), '[]'::jsonb)) as x
      from public.products p
      where p.status <> 'archived' and (p_since is null or p.updated_at >= p_since)
      order by p.updated_at desc limit v_limit) s), '[]'::jsonb);
  elsif p_resource = 'orders' then
    return coalesce((select jsonb_agg(x order by x ->> 'placed_at' desc) from (
      select jsonb_build_object('order_number', o.order_number, 'placed_at', o.placed_at, 'fulfillment_status', o.fulfillment_status,
        'payment_status', o.payment_status, 'shipment_status', o.shipment_status, 'payment_method', o.payment_method,
        'customer_name', o.customer_name, 'customer_phone', o.customer_phone, 'shipping_address', o.shipping_address,
        'subtotal_minor', o.subtotal_minor, 'discount_minor', o.discount_minor, 'shipping_minor', o.shipping_minor,
        'total_minor', o.total_minor, 'coupon_code', o.coupon_code, 'shipping_method', o.shipping_method_code,
        'items', coalesce((select jsonb_agg(jsonb_build_object('title', i.product_title, 'sku', i.sku, 'size', i.size, 'color', i.color,
                  'quantity', i.quantity, 'unit_price_minor', i.unit_price_minor)) from public.order_items i where i.order_id = o.id), '[]'::jsonb)) as x
      from public.orders o
      where (p_since is null or o.placed_at >= p_since)
      order by o.placed_at desc limit v_limit) s), '[]'::jsonb);
  else
    return coalesce((select jsonb_agg(jsonb_build_object('sku', v.sku, 'available', coalesce(av.available, 0)) order by v.sku)
      from (select * from public.product_variants where is_active order by sku limit v_limit) v
      left join lateral public.get_variant_availability(array[v.id]) av on true), '[]'::jsonb);
  end if;
end;
$$;
revoke all on function public.api_v1_read(text, text, timestamptz, int) from public;
grant execute on function public.api_v1_read(text, text, timestamptz, int) to anon;
