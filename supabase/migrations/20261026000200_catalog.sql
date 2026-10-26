-- =============================================================================
-- Fabriklo 0002: catalog (categories, collections, products, variants, media)
-- Public read is limited to active + published rows. Costs live in a separate
-- staff-only table so they can never leak through a public projection.
-- =============================================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  position int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger categories_updated_at before update on public.categories
  for each row execute function private.set_updated_at();

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  is_active boolean not null default true,
  published_at timestamptz,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger collections_updated_at before update on public.collections
  for each row execute function private.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  title text not null check (char_length(title) between 2 and 140),
  subtitle text not null default '' check (char_length(subtitle) <= 200),
  -- Plain text / limited markdown. Rendered escaped; never raw HTML.
  description text not null default '' check (char_length(description) <= 8000),
  materials text not null default '' check (char_length(materials) <= 1000),
  care text not null default '' check (char_length(care) <= 1000),
  category_id uuid references public.categories(id) on delete set null,
  audience text not null default 'unisex' check (audience in ('men', 'women', 'unisex')),
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  published_at timestamptz,
  featured boolean not null default false,
  tryon_enabled boolean not null default false,
  seo_title text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 170),
  is_demo boolean not null default false,
  search tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(subtitle, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint products_active_needs_publish_date check (status <> 'active' or published_at is not null)
);
create index products_category_idx on public.products(category_id);
create index products_status_published_idx on public.products(status, published_at desc);
create index products_audience_idx on public.products(audience);
create index products_search_idx on public.products using gin(search);
create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

create table public.collection_products (
  collection_id uuid not null references public.collections(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  position int not null default 0,
  primary key (collection_id, product_id)
);
create index collection_products_product_idx on public.collection_products(product_id);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku extensions.citext not null unique check (sku ~ '^[A-Za-z0-9][A-Za-z0-9-]{2,39}$'),
  size text not null check (char_length(size) between 1 and 20),
  color text not null check (char_length(color) between 1 and 40),
  color_hex text check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  -- Money is integer minor units (poisha for BDT).
  price_minor integer not null check (price_minor >= 0 and price_minor <= 100000000),
  compare_at_minor integer check (compare_at_minor is null or compare_at_minor > price_minor),
  barcode text check (barcode is null or barcode ~ '^[0-9A-Za-z-]{4,40}$'),
  weight_grams int check (weight_grams is null or weight_grams between 0 and 50000),
  position int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size, color)
);
create index product_variants_product_idx on public.product_variants(product_id);
create index product_variants_size_idx on public.product_variants(size);
create index product_variants_color_idx on public.product_variants(color);
create index product_variants_price_idx on public.product_variants(price_minor);
create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function private.set_updated_at();

create table public.variant_costs (
  variant_id uuid primary key references public.product_variants(id) on delete cascade,
  cost_minor integer not null check (cost_minor >= 0),
  updated_at timestamptz not null default now()
);
create trigger variant_costs_updated_at before update on public.variant_costs
  for each row execute function private.set_updated_at();

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  kind text not null default 'image' check (kind in ('image', 'video')),
  -- Either a path inside the public product-media bucket or a same-origin /assets path.
  storage_path text not null check (storage_path ~ '^[A-Za-z0-9/_.-]{3,300}$' and storage_path !~ '\.\.'),
  alt text not null check (char_length(alt) between 3 and 200),
  width int, height int,
  position int not null default 0,
  is_tryon_garment boolean not null default false,
  created_at timestamptz not null default now()
);
create index product_media_product_idx on public.product_media(product_id, position);

-- -----------------------------------------------------------------------------
-- Visibility helpers
-- -----------------------------------------------------------------------------
create or replace function private.product_is_public(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products p
    where p.id = p_product_id and p.status = 'active'
      and p.published_at is not null and p.published_at <= now());
$$;
revoke all on function private.product_is_public(uuid) from public;
grant execute on function private.product_is_public(uuid) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.collections enable row level security;
alter table public.products enable row level security;
alter table public.collection_products enable row level security;
alter table public.product_variants enable row level security;
alter table public.variant_costs enable row level security;
alter table public.product_media enable row level security;

grant select on public.categories, public.collections, public.products,
  public.collection_products, public.product_variants, public.product_media to anon, authenticated;
grant insert, update, delete on public.categories, public.collections,
  public.collection_products, public.product_variants, public.product_media to authenticated;
-- Products are archived, never hard-deleted from the client.
grant insert, update on public.products to authenticated;
grant select, insert, update on public.variant_costs to authenticated;

-- Public read
create policy "public read active categories" on public.categories
  for select to anon, authenticated using (is_active);
create policy "public read published collections" on public.collections
  for select to anon, authenticated using (is_active and published_at is not null and published_at <= now());
create policy "public read published products" on public.products
  for select to anon, authenticated
  using (status = 'active' and published_at is not null and published_at <= now());
create policy "public read collection membership" on public.collection_products
  for select to anon, authenticated using ((select private.product_is_public(product_id)));
create policy "public read active variants" on public.product_variants
  for select to anon, authenticated using (is_active and (select private.product_is_public(product_id)));
create policy "public read media" on public.product_media
  for select to anon, authenticated using ((select private.product_is_public(product_id)));

-- Staff read (drafts etc.)
create policy "staff read categories" on public.categories
  for select to authenticated using ((select private.has_permission('products.read')));
create policy "staff read collections" on public.collections
  for select to authenticated using ((select private.has_permission('products.read')));
create policy "staff read products" on public.products
  for select to authenticated using ((select private.has_permission('products.read')));
create policy "staff read collection products" on public.collection_products
  for select to authenticated using ((select private.has_permission('products.read')));
create policy "staff read variants" on public.product_variants
  for select to authenticated using ((select private.has_permission('products.read')));
create policy "staff read media" on public.product_media
  for select to authenticated using ((select private.has_permission('products.read')));
create policy "cost readers" on public.variant_costs
  for select to authenticated using ((select private.has_permission('products.costs')));

-- Staff write
create policy "catalog write categories" on public.categories
  for all to authenticated
  using ((select private.has_permission('products.write')))
  with check ((select private.has_permission('products.write')));
create policy "catalog write collections" on public.collections
  for all to authenticated
  using ((select private.has_permission('products.write')))
  with check ((select private.has_permission('products.write')));
create policy "catalog insert products" on public.products
  for insert to authenticated with check ((select private.has_permission('products.write')));
create policy "catalog update products" on public.products
  for update to authenticated
  using ((select private.has_permission('products.write')))
  with check ((select private.has_permission('products.write')));
create policy "catalog write collection products" on public.collection_products
  for all to authenticated
  using ((select private.has_permission('products.write')))
  with check ((select private.has_permission('products.write')));
create policy "catalog write variants" on public.product_variants
  for all to authenticated
  using ((select private.has_permission('products.write')))
  with check ((select private.has_permission('products.write')));
create policy "catalog write media" on public.product_media
  for all to authenticated
  using ((select private.has_permission('products.write')))
  with check ((select private.has_permission('products.write')));
create policy "cost writers insert" on public.variant_costs
  for insert to authenticated with check ((select private.has_permission('products.costs')));
create policy "cost writers update" on public.variant_costs
  for update to authenticated
  using ((select private.has_permission('products.costs')))
  with check ((select private.has_permission('products.costs')));

-- Stamp actor columns server-side so the client cannot forge them.
create or replace function private.stamp_product_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;
  new.updated_by := (select auth.uid());
  -- Publishing without a date publishes now.
  if new.status = 'active' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
create trigger products_stamp_actor before insert or update on public.products
  for each row execute function private.stamp_product_actor();

create trigger products_audit after insert or update on public.products
  for each row execute function private.audit_row_change();
create trigger product_variants_audit after insert or update or delete on public.product_variants
  for each row execute function private.audit_row_change();
create trigger variant_costs_audit after insert or update on public.variant_costs
  for each row execute function private.audit_row_change();
