-- =============================================================================
-- Fabriklo 0009: hero tour drafts vs published versions.
-- hero_scenes becomes the editors' DRAFT working copy. The storefront reads an
-- immutable published snapshot (hero_tour_versions). Publishing and rollback
-- need cms.publish; editing drafts needs cms.edit. Every publish is kept.
-- =============================================================================

create table public.hero_tour_versions (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.hero_tours(id) on delete cascade,
  version int not null,
  scenes jsonb not null check (jsonb_typeof(scenes) = 'array' and jsonb_array_length(scenes) between 1 and 12),
  settings jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tour_id, version)
);
create trigger hero_tour_versions_append_only before update or delete on public.hero_tour_versions
  for each row execute function private.forbid_mutation();

alter table public.hero_tours add column draft_settings jsonb;
alter table public.hero_tours add column published_version_id uuid references public.hero_tour_versions(id);

alter table public.hero_tour_versions enable row level security;
grant select on public.hero_tour_versions to anon, authenticated;
create policy "public read live hero version" on public.hero_tour_versions
  for select to anon, authenticated using (exists (
    select 1 from public.hero_tours t
    where t.id = hero_tour_versions.tour_id and t.published_version_id = hero_tour_versions.id and t.status = 'published'));
create policy "editors read hero versions" on public.hero_tour_versions
  for select to authenticated using ((select private.has_permission('cms.edit')));

-- Drafts are no longer public.
drop policy "public read published scenes" on public.hero_scenes;

create or replace function private.snapshot_hero(p_tour_id uuid, p_note text, p_actor uuid)
returns public.hero_tour_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scenes jsonb;
  v_settings jsonb;
  v_row public.hero_tour_versions;
begin
  perform 1 from public.hero_tours where id = p_tour_id for update;
  select coalesce(jsonb_agg(jsonb_build_object(
      'position', s.position, 'image_path', s.image_path, 'image_alt', s.image_alt, 'eyebrow', s.eyebrow,
      'heading', s.heading, 'body', s.body, 'cta_label', s.cta_label, 'cta_href', s.cta_href,
      'object_position', s.object_position, 'zoom', s.zoom, 'parallax', s.parallax, 'transition_ms', s.transition_ms)
      order by s.position), '[]'::jsonb)
    into v_scenes
  from public.hero_scenes s where s.tour_id = p_tour_id and s.is_published;
  if jsonb_array_length(v_scenes) = 0 then
    raise exception 'a tour needs at least one visible scene' using errcode = '22023', hint = 'no_scenes';
  end if;
  select coalesce(draft_settings,
           jsonb_build_object('renderer', renderer, 'overlay_opacity', overlay_opacity, 'motion_strength', motion_strength))
    into v_settings from public.hero_tours where id = p_tour_id;

  insert into public.hero_tour_versions (tour_id, version, scenes, settings, note, created_by)
  values (p_tour_id,
          coalesce((select max(version) from public.hero_tour_versions where tour_id = p_tour_id), 0) + 1,
          v_scenes, v_settings, nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  returning * into v_row;
  update public.hero_tours
     set published_version_id = v_row.id, status = 'published',
         renderer = coalesce(v_settings ->> 'renderer', renderer),
         overlay_opacity = coalesce((v_settings ->> 'overlay_opacity')::numeric, overlay_opacity),
         motion_strength = coalesce((v_settings ->> 'motion_strength')::numeric, motion_strength)
   where id = p_tour_id;
  return v_row;
end;
$$;
revoke all on function private.snapshot_hero(uuid, text, uuid) from public;

create or replace function public.admin_publish_hero(p_tour_key text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tour public.hero_tours;
  v_row public.hero_tour_versions;
begin
  if not private.has_permission('cms.publish') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_note is not null and char_length(p_note) > 200 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  select * into v_tour from public.hero_tours where key = p_tour_key;
  if not found then
    raise exception 'tour not found' using errcode = 'P0002';
  end if;
  v_row := private.snapshot_hero(v_tour.id, p_note, (select auth.uid()));
  perform private.write_audit('hero.publish', 'hero_tour', v_tour.id::text, null,
    jsonb_build_object('version', v_row.version), p_note);
  return jsonb_build_object('version_id', v_row.id, 'version', v_row.version);
end;
$$;
revoke all on function public.admin_publish_hero(text, text) from public;
grant execute on function public.admin_publish_hero(text, text) to authenticated;

-- Rollback: make an earlier version live again AND restore it as the draft.
create or replace function public.admin_rollback_hero(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.hero_tour_versions;
  s jsonb;
begin
  if not private.has_permission('cms.publish') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v from public.hero_tour_versions where id = p_version_id;
  if not found then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  perform 1 from public.hero_tours where id = v.tour_id for update;
  delete from public.hero_scenes where tour_id = v.tour_id;
  for s in select * from jsonb_array_elements(v.scenes) loop
    insert into public.hero_scenes (tour_id, position, image_path, image_alt, eyebrow, heading, body, cta_label, cta_href,
        object_position, zoom, parallax, transition_ms, is_published)
    values (v.tour_id, (s ->> 'position')::int, s ->> 'image_path', s ->> 'image_alt', coalesce(s ->> 'eyebrow', ''),
        s ->> 'heading', coalesce(s ->> 'body', ''), s ->> 'cta_label', s ->> 'cta_href', s ->> 'object_position',
        (s ->> 'zoom')::numeric, (s ->> 'parallax')::numeric, coalesce((s ->> 'transition_ms')::int, 900), true);
  end loop;
  update public.hero_tours
     set published_version_id = v.id, status = 'published',
         renderer = coalesce(v.settings ->> 'renderer', renderer),
         overlay_opacity = coalesce((v.settings ->> 'overlay_opacity')::numeric, overlay_opacity),
         motion_strength = coalesce((v.settings ->> 'motion_strength')::numeric, motion_strength),
         draft_settings = v.settings
   where id = v.tour_id;
  perform private.write_audit('hero.rollback', 'hero_tour', v.tour_id::text, null,
    jsonb_build_object('version', v.version), null);
  return jsonb_build_object('version_id', v.id, 'version', v.version);
end;
$$;
revoke all on function public.admin_rollback_hero(uuid) from public;
grant execute on function public.admin_rollback_hero(uuid) to authenticated;

-- Existing published tours get their first version from the current scenes.
do $$
declare t record;
begin
  for t in select id from public.hero_tours where status = 'published' loop
    if exists (select 1 from public.hero_scenes where tour_id = t.id and is_published) then
      perform private.snapshot_hero(t.id, 'Initial version', null);
    end if;
  end loop;
end $$;

-- Reordering swaps positions in one statement: make the uniqueness check deferrable.
alter table public.hero_scenes drop constraint hero_scenes_tour_id_position_key;
alter table public.hero_scenes add constraint hero_scenes_tour_id_position_key
  unique (tour_id, position) deferrable initially deferred;

create or replace function public.admin_move_hero_scene(p_scene_id uuid, p_direction int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.hero_scenes;
  b public.hero_scenes;
begin
  if not private.has_permission('cms.edit') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_direction not in (-1, 1) then
    raise exception 'invalid direction' using errcode = '22023';
  end if;
  select * into a from public.hero_scenes where id = p_scene_id for update;
  if not found then
    raise exception 'scene not found' using errcode = 'P0002';
  end if;
  select * into b from public.hero_scenes
   where tour_id = a.tour_id
     and (case when p_direction = 1 then position > a.position else position < a.position end)
   order by case when p_direction = 1 then position end asc, case when p_direction = -1 then position end desc
   limit 1 for update;
  if not found then
    return;
  end if;
  update public.hero_scenes set position = case when id = a.id then b.position else a.position end
   where id in (a.id, b.id);
end;
$$;
revoke all on function public.admin_move_hero_scene(uuid, int) from public;
grant execute on function public.admin_move_hero_scene(uuid, int) to authenticated;

-- Draft tour settings (motion strength, overlay, renderer). Go live on publish.

create or replace function public.admin_update_hero_settings(p_tour_key text, p_renderer text, p_overlay numeric, p_motion numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('cms.edit') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_renderer not in ('scroll-2.5d', 'static') or p_overlay not between 0 and 0.9 or p_motion not between 0 and 1.5 then
    raise exception 'invalid settings' using errcode = '22023';
  end if;
  update public.hero_tours
     set draft_settings = jsonb_build_object('renderer', p_renderer, 'overlay_opacity', p_overlay, 'motion_strength', p_motion)
   where key = p_tour_key;
  if not found then
    raise exception 'tour not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.admin_update_hero_settings(text, text, numeric, numeric) from public;
grant execute on function public.admin_update_hero_settings(text, text, numeric, numeric) to authenticated;

-- Internal links only: also refuse protocol-relative "//host" URLs.
alter table public.hero_scenes drop constraint hero_scenes_cta_href_check;
alter table public.hero_scenes add constraint hero_scenes_cta_href_check
  check (cta_href is null or cta_href ~ '^/([A-Za-z0-9_?=&.-][A-Za-z0-9/_?=&.-]{0,199})?$');
