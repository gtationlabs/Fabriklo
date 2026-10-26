-- =============================================================================
-- Fabriklo 0014: storefront theme versions, staff management, audit viewer and
-- store settings.
--
-- * Theme: one draft (themes.draft_tokens) and immutable published versions
--   (theme_versions). Tokens are a closed set of colour/font/radius keys checked
--   in SQL; the storefront re-validates before emitting CSS, so no free text ever
--   reaches a stylesheet. Drafts need cms.edit; publish/rollback need
--   theme.publish.
-- * Staff: listing with sign-in/MFA facts (counts and timestamps, never secrets),
--   self-activation of an invited member on first aal2 session, a guard that
--   keeps at least one active super admin, and an audited event hook for the
--   server-side invite-link / MFA-reset actions.
-- * Audit viewer: actor directory and facets for staff with audit.read.
-- * Settings: a single audited RPC for the non-secret site_settings keys with
--   per-key validation, and an RPC that saves a shipping zone atomically
--   (fallback swap, district uniqueness, demo-value flag).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Theme tokens
-- -----------------------------------------------------------------------------
create or replace function private.theme_tokens_valid(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_colors jsonb;
  v_fonts jsonb;
  k text;
  v text;
  v_color_keys text[] := array['cream','paper','sand','wood','bronze','bronze_strong','espresso','charcoal','muted','line','danger','success'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  -- Closed set of top-level keys.
  if exists (select 1 from jsonb_object_keys(p) key where key not in ('colors','fonts','radius')) then return false; end if;
  v_colors := p -> 'colors';
  v_fonts := p -> 'fonts';
  if v_colors is null or jsonb_typeof(v_colors) <> 'object' then return false; end if;
  if v_fonts is null or jsonb_typeof(v_fonts) <> 'object' then return false; end if;
  -- Every colour present, every colour a 6-digit hex, no extras.
  for k in select unnest(v_color_keys) loop
    v := v_colors ->> k;
    if v is null or v !~ '^#[0-9a-f]{6}$' then return false; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(v_colors)) <> array_length(v_color_keys, 1) then return false; end if;
  if exists (select 1 from jsonb_object_keys(v_fonts) key where key not in ('display','body')) then return false; end if;
  if coalesce(v_fonts ->> 'display', '') not in ('cormorant','playfair','fraunces') then return false; end if;
  if coalesce(v_fonts ->> 'body', '') not in ('inter','manrope','dm_sans') then return false; end if;
  if coalesce(p ->> 'radius', '') not in ('none','sm','md','lg') then return false; end if;
  return true;
end;
$$;
revoke all on function private.theme_tokens_valid(jsonb) from public;

create table public.themes (
  key text primary key check (key ~ '^[a-z0-9_-]{2,40}$'),
  draft_tokens jsonb not null check (private.theme_tokens_valid(draft_tokens)),
  published_version_id uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger themes_updated_at before update on public.themes
  for each row execute function private.set_updated_at();

create table public.theme_versions (
  id uuid primary key default gen_random_uuid(),
  theme_key text not null references public.themes(key) on delete cascade,
  version int not null check (version >= 1),
  tokens jsonb not null check (private.theme_tokens_valid(tokens)),
  note text check (note is null or char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (theme_key, version)
);
create trigger theme_versions_append_only before update or delete on public.theme_versions
  for each row execute function private.forbid_mutation();
alter table public.themes add constraint themes_published_version_fk
  foreign key (published_version_id) references public.theme_versions(id);

alter table public.themes enable row level security;
alter table public.theme_versions enable row level security;
grant select on public.themes to authenticated;
grant select on public.theme_versions to anon, authenticated;
create policy "editors read theme draft" on public.themes
  for select to authenticated using ((select private.has_permission('cms.edit')));

-- The live pointer lives on a table visitors cannot read, so the policy asks a
-- definer function for it instead of a subquery (which RLS would empty out).
create or replace function private.theme_live_version(p_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.published_version_id from public.themes t where t.key = p_key;
$$;
revoke all on function private.theme_live_version(text) from public;
grant execute on function private.theme_live_version(text) to anon, authenticated;

create policy "public read live theme version" on public.theme_versions
  for select to anon, authenticated using (id = private.theme_live_version(theme_key));
create policy "editors read theme versions" on public.theme_versions
  for select to authenticated using ((select private.has_permission('cms.edit')));

-- Default tokens: the values that app/globals.css ships with.
insert into public.themes (key, draft_tokens) values ('default', '{
  "colors": {"cream": "#f6f0e6", "paper": "#fbf8f3", "sand": "#e7dccb", "wood": "#7a5236", "bronze": "#9c6b30",
             "bronze_strong": "#7c521f", "espresso": "#2b1d14", "charcoal": "#2e2b28", "muted": "#6b625a",
             "line": "#d9cdbb", "danger": "#a1301f", "success": "#2f6b3a"},
  "fonts": {"display": "cormorant", "body": "inter"},
  "radius": "sm"
}'::jsonb);

-- Live theme for the storefront: published tokens only (null until first publish → CSS defaults).
create or replace function public.get_theme(p_key text default 'default')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select v.tokens from public.themes t join public.theme_versions v on v.id = t.published_version_id where t.key = p_key;
$$;
revoke all on function public.get_theme(text) from public;
grant execute on function public.get_theme(text) to anon, authenticated;

create or replace function public.admin_save_theme_draft(p_tokens jsonb, p_key text default 'default')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
begin
  if not private.has_permission('cms.edit') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not private.theme_tokens_valid(p_tokens) then
    raise exception 'theme tokens are invalid' using errcode = '22023', hint = 'theme_invalid';
  end if;
  select draft_tokens into v_old from public.themes where key = p_key for update;
  if not found then
    raise exception 'theme not found' using errcode = 'P0002';
  end if;
  update public.themes set draft_tokens = p_tokens, updated_by = (select auth.uid()) where key = p_key;
  perform private.write_audit('theme.draft', 'theme', p_key, v_old, p_tokens, null);
  return p_tokens;
end;
$$;
revoke all on function public.admin_save_theme_draft(jsonb, text) from public;
grant execute on function public.admin_save_theme_draft(jsonb, text) to authenticated;

create or replace function public.admin_publish_theme(p_note text default null, p_key text default 'default')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_theme public.themes;
  v_row public.theme_versions;
begin
  if not private.has_permission('theme.publish') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_note is not null and char_length(p_note) > 200 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  select * into v_theme from public.themes where key = p_key for update;
  if not found then
    raise exception 'theme not found' using errcode = 'P0002';
  end if;
  insert into public.theme_versions (theme_key, version, tokens, note, created_by)
  values (p_key, coalesce((select max(version) from public.theme_versions where theme_key = p_key), 0) + 1,
          v_theme.draft_tokens, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  returning * into v_row;
  update public.themes set published_version_id = v_row.id where key = p_key;
  perform private.write_audit('theme.publish', 'theme', p_key, null, jsonb_build_object('version', v_row.version), p_note);
  return jsonb_build_object('version_id', v_row.id, 'version', v_row.version);
end;
$$;
revoke all on function public.admin_publish_theme(text, text) from public;
grant execute on function public.admin_publish_theme(text, text) to authenticated;

-- Rollback makes an earlier version live again AND restores it as the draft.
create or replace function public.admin_rollback_theme(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.theme_versions;
begin
  if not private.has_permission('theme.publish') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v from public.theme_versions where id = p_version_id;
  if not found then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  update public.themes set published_version_id = v.id, draft_tokens = v.tokens, updated_by = (select auth.uid())
   where key = v.theme_key;
  perform private.write_audit('theme.rollback', 'theme', v.theme_key, null, jsonb_build_object('version', v.version), null);
  return jsonb_build_object('version_id', v.id, 'version', v.version);
end;
$$;
revoke all on function public.admin_rollback_theme(uuid) from public;
grant execute on function public.admin_rollback_theme(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Staff management
-- -----------------------------------------------------------------------------

-- Directory for the Staff page. Reads auth.users for email / last sign-in and
-- auth.mfa_factors for "has a verified authenticator" — never secrets or hashes.
create or replace function public.admin_list_staff()
returns table (
  user_id uuid, email text, role_code text, status text, display_name text,
  created_at timestamptz, last_sign_in_at timestamptz, mfa_enrolled boolean, is_self boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select sm.user_id, u.email::text, sm.role_code, sm.status, sm.display_name, sm.created_at, u.last_sign_in_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = sm.user_id and f.status = 'verified') as mfa_enrolled,
         sm.user_id = (select auth.uid()) as is_self
  from public.staff_members sm
  join auth.users u on u.id = sm.user_id
  where private.has_permission('staff.manage')
  order by sm.status = 'active' desc, sm.created_at;
$$;
revoke all on function public.admin_list_staff() from public;
grant execute on function public.admin_list_staff() to authenticated;

-- Looks up an auth user by email so an existing account (e.g. a customer) can be
-- made staff without creating a second account. Returns only the id.
create or replace function public.admin_find_user_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u
  where private.has_permission('staff.manage') and lower(u.email) = lower(btrim(p_email))
  limit 1;
$$;
revoke all on function public.admin_find_user_by_email(text) from public;
grant execute on function public.admin_find_user_by_email(text) to authenticated;

-- An invited member becomes active on their first verified (aal2) session.
create or replace function public.staff_activate_self()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_mfa_verified() then
    return false;
  end if;
  update public.staff_members set status = 'active'
   where user_id = (select auth.uid()) and status = 'invited';
  if found then
    perform private.write_audit('staff.activate', 'staff_members', (select auth.uid())::text, null, null, 'first MFA sign-in');
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public.staff_activate_self() from public;
grant execute on function public.staff_activate_self() to authenticated;

-- Never leave the store without an active super admin.
create or replace function private.protect_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role_code = 'super_admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role_code <> 'super_admin' or new.status <> 'active') then
    if not exists (
      select 1 from public.staff_members sm
      where sm.role_code = 'super_admin' and sm.status = 'active' and sm.user_id <> old.user_id) then
      raise exception 'the last active super admin cannot be removed, suspended or demoted'
        using errcode = '22023', hint = 'last_super_admin';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.protect_last_super_admin() from public;
create trigger staff_members_protect_last_super_admin before update or delete on public.staff_members
  for each row execute function private.protect_last_super_admin();

-- Server actions that must use the Auth admin API (invite link, MFA reset) record
-- what they did here, under the acting staff member's identity.
create or replace function public.admin_record_staff_event(p_action text, p_user_id uuid, p_detail jsonb default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('staff.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_action not in ('staff.invite_link', 'staff.mfa_reset', 'staff.password_reset_link') then
    raise exception 'unknown staff event' using errcode = '22023';
  end if;
  if p_action = 'staff.mfa_reset' and p_user_id = (select auth.uid()) then
    raise exception 'use your own account settings to change your authenticator' using errcode = '22023';
  end if;
  if p_action = 'staff.mfa_reset' and exists (
      select 1 from public.staff_members sm where sm.user_id = p_user_id and sm.role_code = 'super_admin')
     and not private.is_super_admin() then
    raise exception 'only a super admin can reset a super admin''s authenticator' using errcode = '42501';
  end if;
  perform private.write_audit(p_action, 'staff_members', p_user_id::text, null, p_detail, p_reason);
end;
$$;
revoke all on function public.admin_record_staff_event(text, uuid, jsonb, text) from public;
grant execute on function public.admin_record_staff_event(text, uuid, jsonb, text) to authenticated;

-- Which staff may be the target of an MFA reset by the caller (mirrors the rule above, for the UI).
create or replace function public.admin_can_reset_mfa(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('staff.manage')
     and p_user_id <> (select auth.uid())
     and exists (select 1 from public.staff_members sm where sm.user_id = p_user_id)
     and (not exists (select 1 from public.staff_members sm where sm.user_id = p_user_id and sm.role_code = 'super_admin')
          or private.is_super_admin());
$$;
revoke all on function public.admin_can_reset_mfa(uuid) from public;
grant execute on function public.admin_can_reset_mfa(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Audit viewer helpers
-- -----------------------------------------------------------------------------
create or replace function public.admin_audit_actors()
returns table (user_id uuid, display_name text, role_code text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select sm.user_id, sm.display_name, sm.role_code, sm.status
  from public.staff_members sm
  where private.has_permission('audit.read');
$$;
revoke all on function public.admin_audit_actors() from public;
grant execute on function public.admin_audit_actors() to authenticated;

create or replace function public.admin_audit_facets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.has_permission('audit.read') then jsonb_build_object(
    'entity_types', coalesce((select jsonb_agg(t order by t) from (select distinct entity_type as t from public.audit_events) x), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(a order by a) from (select distinct action as a from public.audit_events) y), '[]'::jsonb),
    'total', (select count(*) from public.audit_events))
  else null end;
$$;
revoke all on function public.admin_audit_facets() from public;
grant execute on function public.admin_audit_facets() to authenticated;

-- -----------------------------------------------------------------------------
-- Store settings
-- -----------------------------------------------------------------------------
insert into public.site_settings (key, value, is_public) values
  ('store.identity', '{"name": "Fabriklo", "tagline": "Considered clothing for everyday Dhaka", "currency": "BDT", "locale": "en-BD"}', true),
  ('store.contact', '{"email": "hello@example.com", "phone": "+8801700000000", "address": "", "hours": "", "note": "Placeholder contact details (demo)"}', true),
  ('checkout.cod', '{"enabled": true, "max_order_minor": 2000000}', false),
  ('checkout.online', '{"enabled": true, "hold_minutes": 30}', false),
  -- Set by the owner from Admin → Settings once real shipping rates / COD limit are entered.
  ('store.setup', '{"rates_confirmed": false}', false)
on conflict (key) do nothing;

create or replace function private.validate_site_setting(p_key text, p_value jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'setting must be an object' using errcode = '22023';
  end if;
  if p_key = 'store.identity' then
    if exists (select 1 from jsonb_object_keys(p_value) k where k not in ('name','tagline','currency','locale')) then
      raise exception 'unknown identity field' using errcode = '22023';
    end if;
    v := p_value ->> 'name';
    if v is null or char_length(btrim(v)) not between 2 and 60 or v ~ '[<>]' then
      raise exception 'store name must be 2 to 60 characters' using errcode = '22023', hint = 'name';
    end if;
    if char_length(coalesce(p_value ->> 'tagline', '')) > 120 or coalesce(p_value ->> 'tagline', '') ~ '[<>]' then
      raise exception 'tagline must be at most 120 characters' using errcode = '22023', hint = 'tagline';
    end if;
    if coalesce(p_value ->> 'currency', '') <> 'BDT' then
      raise exception 'currency must be BDT' using errcode = '22023', hint = 'currency';
    end if;
    if coalesce(p_value ->> 'locale', '') not in ('en-BD', 'bn-BD') then
      raise exception 'locale must be en-BD or bn-BD' using errcode = '22023', hint = 'locale';
    end if;
  elsif p_key = 'store.contact' then
    if exists (select 1 from jsonb_object_keys(p_value) k where k not in ('email','phone','address','hours','note')) then
      raise exception 'unknown contact field' using errcode = '22023';
    end if;
    if coalesce(p_value ->> 'email', '') !~ '^[^@\s]{1,64}@[^@\s]{1,255}\.[a-zA-Z]{2,24}$' then
      raise exception 'enter a valid contact email' using errcode = '22023', hint = 'email';
    end if;
    if coalesce(p_value ->> 'phone', '') !~ '^\+8801[3-9][0-9]{8}$' then
      raise exception 'phone must be a Bangladesh number in +8801XXXXXXXXX form' using errcode = '22023', hint = 'phone';
    end if;
    if char_length(coalesce(p_value ->> 'address', '')) > 200 or char_length(coalesce(p_value ->> 'hours', '')) > 120
       or char_length(coalesce(p_value ->> 'note', '')) > 200 then
      raise exception 'contact text is too long' using errcode = '22023';
    end if;
    if (p_value::text) ~ '[<>]' then
      raise exception 'contact text cannot contain angle brackets' using errcode = '22023';
    end if;
  elsif p_key = 'checkout.cod' then
    if exists (select 1 from jsonb_object_keys(p_value) k where k not in ('enabled','max_order_minor')) then
      raise exception 'unknown cash on delivery field' using errcode = '22023';
    end if;
    if jsonb_typeof(p_value -> 'enabled') <> 'boolean' then
      raise exception 'enabled must be true or false' using errcode = '22023', hint = 'enabled';
    end if;
    if jsonb_typeof(p_value -> 'max_order_minor') <> 'number'
       or (p_value ->> 'max_order_minor')::numeric <> floor((p_value ->> 'max_order_minor')::numeric)
       or (p_value ->> 'max_order_minor')::numeric not between 10000 and 100000000 then
      raise exception 'the cash on delivery limit must be between 100 and 1,000,000 taka' using errcode = '22023', hint = 'max_order_minor';
    end if;
  elsif p_key = 'checkout.online' then
    if exists (select 1 from jsonb_object_keys(p_value) k where k not in ('enabled','hold_minutes')) then
      raise exception 'unknown online payment field' using errcode = '22023';
    end if;
    if jsonb_typeof(p_value -> 'enabled') <> 'boolean' then
      raise exception 'enabled must be true or false' using errcode = '22023', hint = 'enabled';
    end if;
    if jsonb_typeof(p_value -> 'hold_minutes') <> 'number' or (p_value ->> 'hold_minutes')::numeric not between 5 and 120
       or (p_value ->> 'hold_minutes')::numeric <> floor((p_value ->> 'hold_minutes')::numeric) then
      raise exception 'stock hold must be between 5 and 120 minutes' using errcode = '22023', hint = 'hold_minutes';
    end if;
  elsif p_key = 'store.setup' then
    if exists (select 1 from jsonb_object_keys(p_value) k where k not in ('rates_confirmed')) or jsonb_typeof(p_value -> 'rates_confirmed') <> 'boolean' then
      raise exception 'invalid setup flag' using errcode = '22023';
    end if;
  else
    raise exception 'this setting cannot be changed here' using errcode = '22023', hint = 'unknown_key';
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
  v_public := p_key in ('store.identity', 'store.contact');
  select value into v_old from public.site_settings where key = p_key for update;
  insert into public.site_settings (key, value, is_public, updated_by) values (p_key, p_value, v_public, (select auth.uid()))
  on conflict (key) do update set value = excluded.value, is_public = excluded.is_public, updated_by = excluded.updated_by;
  perform private.write_audit('settings.update', 'site_settings', p_key, v_old, p_value, null);
  return p_value;
end;
$$;
revoke all on function public.admin_update_site_setting(text, jsonb) from public;
grant execute on function public.admin_update_site_setting(text, jsonb) to authenticated;

-- Shipping zones: one RPC so the fallback swap, district uniqueness and the
-- "no district in two active zones" rule hold in a single transaction.
create or replace function public.admin_save_shipping_zone(p jsonb)
returns public.shipping_zones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_row public.shipping_zones;
  v_old jsonb;
  v_districts text[];
  v_clash text;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'invalid zone' using errcode = '22023';
  end if;
  v_id := nullif(p ->> 'id', '')::uuid;
  select coalesce(array_agg(distinct btrim(d) order by btrim(d)), '{}') into v_districts
    from jsonb_array_elements_text(coalesce(p -> 'districts', '[]'::jsonb)) d where btrim(d) <> '';
  if array_length(v_districts, 1) > 64 then
    raise exception 'too many districts' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_districts) d where d !~ '^[A-Za-z'' .-]{2,40}$') then
    raise exception 'district names may only contain letters, spaces, apostrophes and hyphens' using errcode = '22023', hint = 'districts';
  end if;
  if not coalesce((p ->> 'is_fallback')::boolean, false) and array_length(v_districts, 1) is null and coalesce((p ->> 'is_active')::boolean, true) then
    raise exception 'an active zone needs at least one district unless it is the fallback' using errcode = '22023', hint = 'districts';
  end if;
  if coalesce((p ->> 'is_active')::boolean, true) then
    select z.name into v_clash from public.shipping_zones z
     where z.is_active and (v_id is null or z.id <> v_id) and z.districts && v_districts limit 1;
    if v_clash is not null then
      raise exception 'a district is already covered by zone "%"', v_clash using errcode = '22023', hint = 'district_taken';
    end if;
  end if;

  if v_id is not null then
    select to_jsonb(z) into v_old from public.shipping_zones z where z.id = v_id for update;
    if v_old is null then
      raise exception 'zone not found' using errcode = 'P0002';
    end if;
  end if;
  -- Only one active fallback: demote the previous one in the same transaction.
  if coalesce((p ->> 'is_fallback')::boolean, false) and coalesce((p ->> 'is_active')::boolean, true) then
    update public.shipping_zones set is_fallback = false where is_fallback and is_active and (v_id is null or id <> v_id);
  elsif v_id is not null and (v_old ->> 'is_fallback')::boolean and coalesce((p ->> 'is_active')::boolean, true) then
    -- Turning the fallback off leaves the store without one: refuse.
    if exists (select 1 from public.shipping_zones z where z.id = v_id and z.is_fallback)
       and not coalesce((p ->> 'is_fallback')::boolean, false) then
      raise exception 'mark another zone as the fallback first' using errcode = '22023', hint = 'fallback_required';
    end if;
  end if;

  if v_id is null then
    insert into public.shipping_zones (code, name, districts, is_fallback, fee_minor, free_over_minor, cod_enabled,
                                       estimate_min_days, estimate_max_days, is_active, position)
    values (lower(p ->> 'code'), btrim(p ->> 'name'), v_districts, coalesce((p ->> 'is_fallback')::boolean, false),
            (p ->> 'fee_minor')::int, nullif(p ->> 'free_over_minor', '')::int, coalesce((p ->> 'cod_enabled')::boolean, true),
            coalesce((p ->> 'estimate_min_days')::int, 1), coalesce((p ->> 'estimate_max_days')::int, 3),
            coalesce((p ->> 'is_active')::boolean, true),
            coalesce((select max(position) + 1 from public.shipping_zones), 0))
    returning * into v_row;
  else
    update public.shipping_zones
       set name = btrim(p ->> 'name'), districts = v_districts, is_fallback = coalesce((p ->> 'is_fallback')::boolean, false),
           fee_minor = (p ->> 'fee_minor')::int, free_over_minor = nullif(p ->> 'free_over_minor', '')::int,
           cod_enabled = coalesce((p ->> 'cod_enabled')::boolean, true),
           estimate_min_days = coalesce((p ->> 'estimate_min_days')::int, estimate_min_days),
           estimate_max_days = coalesce((p ->> 'estimate_max_days')::int, estimate_max_days),
           is_active = coalesce((p ->> 'is_active')::boolean, true)
     where id = v_id
    returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke all on function public.admin_save_shipping_zone(jsonb) from public;
grant execute on function public.admin_save_shipping_zone(jsonb) to authenticated;

-- Invited members count as staff for the sign-in / MFA flow (no permissions until
-- active: private.has_permission still requires status = 'active').
create or replace function public.my_staff_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'aal', coalesce((select auth.jwt() ->> 'aal'), 'aal1'),
    'is_staff', sm.user_id is not null and sm.status in ('active', 'invited'),
    'status', sm.status,
    'role', sm.role_code,
    'display_name', sm.display_name,
    'permissions', case when sm.status = 'active' then coalesce(
      (select jsonb_agg(rp.permission_code order by rp.permission_code)
         from public.role_permissions rp where rp.role_code = sm.role_code),
      '[]'::jsonb) else '[]'::jsonb end
  )
  from (select 1) one
  left join public.staff_members sm on sm.user_id = (select auth.uid());
$$;
