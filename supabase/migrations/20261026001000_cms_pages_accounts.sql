-- =============================================================================
-- Fabriklo 0010: content pages (draft blocks -> immutable published versions,
-- allow-listed block types only) and customer account helpers.
-- =============================================================================

-- Allow-listed block structure. The app validates every field with Zod; this
-- is the database backstop: known types only, bounded size, no markup keys.
create or replace function private.cms_blocks_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 60
     and octet_length(p::text) <= 60000
     and not exists (
       select 1 from jsonb_array_elements(p) b
       where jsonb_typeof(b) <> 'object'
          or coalesce(b ->> 'type', '') not in ('heading', 'paragraph', 'list', 'faq', 'callout', 'cta', 'image')
          or b ?| array['html', 'script', 'css', 'js', 'onclick', 'innerHTML'])
     and p::text !~* '(<\s*script|javascript:|data:text/html|<\s*iframe)';
$$;

alter table public.cms_pages add column draft_blocks jsonb not null default '[]'::jsonb
  check (private.cms_blocks_valid(draft_blocks));
alter table public.cms_pages add column page_kind text not null default 'page' check (page_kind in ('page', 'legal', 'help'));
alter table public.cms_pages add column updated_by uuid;
alter table public.cms_page_versions add constraint cms_page_versions_blocks_valid check (private.cms_blocks_valid(blocks));
alter table public.cms_page_versions add column title text;
alter table public.cms_page_versions add column note text check (note is null or char_length(note) <= 200);

create trigger cms_pages_audit after insert or update on public.cms_pages
  for each row execute function private.audit_row_change();

-- Editors (cms.edit) may change drafts of any page; only cms.publish may change
-- what is live (status / published version), and only via the RPCs below.
drop policy "editors update pages" on public.cms_pages;
create policy "editors update pages" on public.cms_pages
  for update to authenticated
  using ((select private.has_permission('cms.edit')))
  with check ((select private.has_permission('cms.edit')));

-- SECURITY INVOKER on purpose: current_user is the API role for direct writes,
-- and the function owner when called from the (permission-checked) RPCs.
create or replace function private.guard_page_publish()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.status is distinct from old.status or new.published_version_id is distinct from old.published_version_id)
     and current_user not in ('postgres', 'supabase_admin', 'service_role')
     and not private.has_permission('cms.publish') then
    raise exception 'publishing needs cms.publish' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger cms_pages_guard_publish before update on public.cms_pages
  for each row execute function private.guard_page_publish();

-- Reserved paths that a CMS page may never shadow.
alter table public.cms_pages add constraint cms_pages_slug_not_reserved check (
  split_part(slug::text, '/', 1) not in ('admin', 'api', 'account', 'auth', 'cart', 'checkout', 'shop', 'men', 'women',
    'search', 'product', 'category', 'collections', 'order', 'orders', 'assets', '_next'));

-- Publishing creates an immutable version from the draft and points the page at it.
create or replace function public.admin_publish_page(p_page_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pg public.cms_pages;
  v public.cms_page_versions;
begin
  if not private.has_permission('cms.publish') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into pg from public.cms_pages where id = p_page_id for update;
  if not found then
    raise exception 'page not found' using errcode = 'P0002';
  end if;
  if jsonb_array_length(pg.draft_blocks) = 0 then
    raise exception 'add some content before publishing' using errcode = '22023', hint = 'empty_page';
  end if;
  insert into public.cms_page_versions (page_id, version, blocks, title, note, created_by)
  values (pg.id, coalesce((select max(version) from public.cms_page_versions where page_id = pg.id), 0) + 1,
          pg.draft_blocks, pg.title, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  returning * into v;
  update public.cms_pages set published_version_id = v.id, status = 'published', updated_by = (select auth.uid())
   where id = pg.id;
  perform private.write_audit('page.publish', 'cms_page', pg.id::text, null,
    jsonb_build_object('version', v.version, 'slug', pg.slug), p_note);
  return jsonb_build_object('version_id', v.id, 'version', v.version);
end;
$$;
revoke all on function public.admin_publish_page(uuid, text) from public;
grant execute on function public.admin_publish_page(uuid, text) to authenticated;

create or replace function public.admin_rollback_page(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cms_page_versions;
begin
  if not private.has_permission('cms.publish') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v from public.cms_page_versions where id = p_version_id;
  if not found then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  update public.cms_pages
     set published_version_id = v.id, status = 'published', draft_blocks = v.blocks,
         title = coalesce(v.title, title), updated_by = (select auth.uid())
   where id = v.page_id;
  perform private.write_audit('page.rollback', 'cms_page', v.page_id::text, null, jsonb_build_object('version', v.version), null);
  return jsonb_build_object('version_id', v.id, 'version', v.version);
end;
$$;
revoke all on function public.admin_rollback_page(uuid) from public;
grant execute on function public.admin_rollback_page(uuid) to authenticated;

create or replace function public.admin_unpublish_page(p_page_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('cms.publish') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.cms_pages set status = 'archived', updated_by = (select auth.uid()) where id = p_page_id;
  perform private.write_audit('page.unpublish', 'cms_page', p_page_id::text, null, null, null);
end;
$$;
revoke all on function public.admin_unpublish_page(uuid) from public;
grant execute on function public.admin_unpublish_page(uuid) to authenticated;

-- Public read of a live page by slug (published version only).
create or replace function public.get_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('slug', p.slug, 'title', coalesce(v.title, p.title), 'kind', p.page_kind,
           'seo_title', p.seo_title, 'seo_description', p.seo_description,
           'blocks', v.blocks, 'version', v.version, 'published_at', v.created_at)
  from public.cms_pages p
  join public.cms_page_versions v on v.id = p.published_version_id
  where p.slug = p_slug::extensions.citext and p.status = 'published';
$$;
revoke all on function public.get_page(text) from public;
grant execute on function public.get_page(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Customer accounts
-- -----------------------------------------------------------------------------
-- One default address per customer.
create unique index addresses_one_default on public.addresses(user_id) where is_default;

-- Customers read their own order history with tracking tokens re-derived on demand.
create or replace function public.my_order_tracking_token(p_order_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.orders where id = p_order_id and user_id = (select auth.uid())) then
    return null;
  end if;
  return private.tracking_token(p_order_id);
end;
$$;
revoke all on function public.my_order_tracking_token(uuid) from public;
grant execute on function public.my_order_tracking_token(uuid) to authenticated;
grant execute on function private.guard_page_publish() to authenticated;
