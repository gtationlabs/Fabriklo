-- =============================================================================
-- Fabriklo 0005: CMS (pages, hero tour scenes, settings), storage buckets and
-- policies, AI try-on job records. Content is typed data validated by Zod in the
-- app and by CHECK constraints here; no executable HTML/JS is stored.
-- =============================================================================

create table public.cms_pages (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$'),
  title text not null check (char_length(title) between 1 and 140),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_version_id uuid,
  seo_title text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 170),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger cms_pages_updated_at before update on public.cms_pages
  for each row execute function private.set_updated_at();

create table public.cms_page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.cms_pages(id) on delete cascade,
  version int not null,
  -- Array of allow-listed blocks: [{type: 'rich_text' | 'cta' | ..., ...}] (validated in app)
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (page_id, version)
);
alter table public.cms_pages add constraint cms_pages_published_version_fk
  foreign key (published_version_id) references public.cms_page_versions(id) on delete set null;
create trigger cms_page_versions_immutable before update on public.cms_page_versions
  for each row execute function private.forbid_mutation();

create table public.hero_tours (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_-]{2,40}$'),
  renderer text not null default 'scroll-2.5d' check (renderer in ('scroll-2.5d', 'static', 'gltf')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  overlay_opacity numeric(3,2) not null default 0.35 check (overlay_opacity between 0 and 0.9),
  motion_strength numeric(3,2) not null default 1 check (motion_strength between 0 and 1.5),
  updated_at timestamptz not null default now()
);
create trigger hero_tours_updated_at before update on public.hero_tours
  for each row execute function private.set_updated_at();

create table public.hero_scenes (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.hero_tours(id) on delete cascade,
  position int not null check (position between 1 and 12),
  image_path text not null check (image_path ~ '^/assets/store/[a-z0-9_-]+\.(webp|jpg|png|avif)$'),
  image_alt text not null check (char_length(image_alt) between 10 and 300),
  eyebrow text not null default '' check (char_length(eyebrow) <= 60),
  heading text not null check (char_length(heading) between 1 and 90),
  body text not null default '' check (char_length(body) <= 280),
  cta_label text check (cta_label is null or char_length(cta_label) between 2 and 40),
  -- Internal paths only (no javascript:, no external hosts)
  cta_href text check (cta_href is null or cta_href ~ '^/[A-Za-z0-9/_?=&.-]{0,200}$'),
  object_position text not null default '50% 50%' check (object_position ~ '^(100|[1-9]?[0-9])% (100|[1-9]?[0-9])%$'),
  zoom numeric(4,3) not null default 1.08 check (zoom between 1 and 1.4),
  parallax numeric(4,3) not null default 0.04 check (parallax between 0 and 0.15),
  transition_ms int not null default 900 check (transition_ms between 200 and 3000),
  is_published boolean not null default true,
  unique (tour_id, position)
);

create table public.site_settings (
  key text primary key check (key ~ '^[a-z0-9_.]{2,60}$'),
  -- Non-secret configuration only. Secrets live in the deployment secret store.
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create trigger site_settings_updated_at before update on public.site_settings
  for each row execute function private.set_updated_at();

alter table public.cms_pages enable row level security;
alter table public.cms_page_versions enable row level security;
alter table public.hero_tours enable row level security;
alter table public.hero_scenes enable row level security;
alter table public.site_settings enable row level security;

grant select on public.cms_pages, public.cms_page_versions, public.hero_tours, public.hero_scenes, public.site_settings to anon, authenticated;
grant insert, update on public.cms_pages, public.hero_tours, public.hero_scenes, public.site_settings to authenticated;
grant insert on public.cms_page_versions to authenticated;
grant delete on public.hero_scenes to authenticated;

create policy "public read published pages" on public.cms_pages
  for select to anon, authenticated using (status = 'published');
create policy "public read published page versions" on public.cms_page_versions
  for select to anon, authenticated using (exists (
    select 1 from public.cms_pages p
    where p.published_version_id = cms_page_versions.id and p.status = 'published'));
create policy "public read published tours" on public.hero_tours
  for select to anon, authenticated using (status = 'published');
create policy "public read published scenes" on public.hero_scenes
  for select to anon, authenticated using (is_published and exists (
    select 1 from public.hero_tours t where t.id = tour_id and t.status = 'published'));
create policy "public read public settings" on public.site_settings
  for select to anon, authenticated using (is_public);

create policy "editors read pages" on public.cms_pages
  for select to authenticated using ((select private.has_permission('cms.edit')));
create policy "editors read versions" on public.cms_page_versions
  for select to authenticated using ((select private.has_permission('cms.edit')));
create policy "editors read tours" on public.hero_tours
  for select to authenticated using ((select private.has_permission('cms.edit')));
create policy "editors read scenes" on public.hero_scenes
  for select to authenticated using ((select private.has_permission('cms.edit')));
create policy "settings managers read" on public.site_settings
  for select to authenticated using ((select private.has_permission('settings.manage')));

create policy "editors write pages" on public.cms_pages
  for insert to authenticated with check ((select private.has_permission('cms.edit')) and status = 'draft');
-- Moving a page to published requires cms.publish.
create policy "editors update pages" on public.cms_pages
  for update to authenticated
  using ((select private.has_permission('cms.edit')))
  with check ((select private.has_permission('cms.edit'))
    and (status <> 'published' or (select private.has_permission('cms.publish'))));
create policy "editors add versions" on public.cms_page_versions
  for insert to authenticated with check ((select private.has_permission('cms.edit')));
create policy "editors write tours" on public.hero_tours
  for insert to authenticated with check ((select private.has_permission('cms.edit')) and status = 'draft');
create policy "editors update tours" on public.hero_tours
  for update to authenticated
  using ((select private.has_permission('cms.edit')))
  with check ((select private.has_permission('cms.edit'))
    and (status <> 'published' or (select private.has_permission('cms.publish'))));
create policy "editors write scenes" on public.hero_scenes
  for all to authenticated
  using ((select private.has_permission('cms.edit')))
  with check ((select private.has_permission('cms.edit')));
create policy "settings managers write" on public.site_settings
  for insert to authenticated with check ((select private.has_permission('settings.manage')));
create policy "settings managers update" on public.site_settings
  for update to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));

create trigger hero_scenes_audit after insert or update or delete on public.hero_scenes
  for each row execute function private.audit_row_change();
create trigger hero_tours_audit after insert or update on public.hero_tours
  for each row execute function private.audit_row_change();
create trigger site_settings_audit after insert or update on public.site_settings
  for each row execute function private.audit_row_change();

-- -----------------------------------------------------------------------------
-- AI try-on job records (worker + provider adapter arrive in the try-on slice)
-- -----------------------------------------------------------------------------
create table public.tryon_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  status text not null default 'queued' check (status in ('uploading', 'queued', 'processing', 'completed', 'failed', 'expired', 'cancelled')),
  input_path text not null check (input_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,120}$'),
  output_path text check (output_path is null or output_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,120}$'),
  provider text not null default 'mock' check (provider in ('mock', 'fashn')),
  consent_at timestamptz not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  constraint tryon_paths_owned check (split_part(input_path, '/', 1) = user_id::text
    and (output_path is null or split_part(output_path, '/', 1) = user_id::text))
);
create index tryon_jobs_user_idx on public.tryon_jobs(user_id, created_at desc);
create index tryon_jobs_status_idx on public.tryon_jobs(status) where status in ('queued', 'processing');
create trigger tryon_jobs_updated_at before update on public.tryon_jobs
  for each row execute function private.set_updated_at();

alter table public.tryon_jobs enable row level security;
grant select, delete on public.tryon_jobs to authenticated;
create policy "own tryon jobs read" on public.tryon_jobs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own tryon jobs delete" on public.tryon_jobs
  for delete to authenticated using (user_id = (select auth.uid()));
-- Staff see operational metadata through a dedicated RPC (try-on slice), not photos.

-- -----------------------------------------------------------------------------
-- Storage buckets + object policies
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-media', 'product-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('tryon-inputs', 'tryon-inputs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('tryon-outputs', 'tryon-outputs', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "catalog editors upload product media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-media' and (select private.has_permission('products.write')));
create policy "catalog editors update product media" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-media' and (select private.has_permission('products.write')))
  with check (bucket_id = 'product-media' and (select private.has_permission('products.write')));
create policy "catalog editors delete product media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-media' and (select private.has_permission('products.write')));

-- Try-on inputs: owner-only, first path segment must be the user's id.
create policy "owner reads tryon inputs" on storage.objects
  for select to authenticated
  using (bucket_id = 'tryon-inputs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner uploads tryon inputs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tryon-inputs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner deletes tryon inputs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tryon-inputs' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Try-on outputs are written by the worker (service role); owners read/delete.
create policy "owner reads tryon outputs" on storage.objects
  for select to authenticated
  using (bucket_id = 'tryon-outputs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner deletes tryon outputs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tryon-outputs' and (storage.foldername(name))[1] = (select auth.uid())::text);
