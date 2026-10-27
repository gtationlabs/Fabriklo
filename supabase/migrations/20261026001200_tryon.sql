-- =============================================================================
-- Fabriklo 0012: AI virtual try-on. Rules: photos live only in private
-- per-user storage paths; jobs run on the trusted server (never the browser);
-- the provider is called only by the worker; quotas and a daily credit cap are
-- enforced in the database; everything expires and is purged; staff see
-- operational counts, never photos.
-- =============================================================================

-- Postgres regexes cap repetition counts at 255, so the media path CHECK from
-- 0002 ('{3,300}') failed on the first real insert. Same rule, valid syntax.
alter table public.product_media drop constraint product_media_storage_path_check;
alter table public.product_media add constraint product_media_storage_path_check
  check (storage_path ~ '^[A-Za-z0-9/_.-]+$' and char_length(storage_path) between 3 and 300 and storage_path !~ '\.\.');

-- ---------------------------------------------------------------------------
-- Job record: extra operational columns (schema introduced in 0005).
-- ---------------------------------------------------------------------------
alter table public.tryon_jobs
  add column garment_media_id uuid references public.product_media(id) on delete set null,
  add column garment_path text check (garment_path is null or (garment_path ~ '^[A-Za-z0-9/_.-]+$' and char_length(garment_path) between 3 and 300 and garment_path !~ '\.\.')),
  add column settings jsonb not null default '{}'::jsonb,
  add column provider_job_id text check (provider_job_id is null or char_length(provider_job_id) <= 120),
  add column attempts int not null default 0 check (attempts between 0 and 10),
  add column error_message text check (error_message is null or char_length(error_message) <= 300),
  add column consent_version text check (consent_version is null or char_length(consent_version) <= 40),
  add column ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
  add column credits int not null default 0 check (credits >= 0),
  add column started_at timestamptz,
  add column completed_at timestamptz;
create index tryon_jobs_expiry_idx on public.tryon_jobs(expires_at);
create index tryon_jobs_created_idx on public.tryon_jobs(created_at);

-- Customers never update job rows directly (no update grant); they cancel/delete through RPC/RLS.
revoke update on public.tryon_jobs from authenticated;

-- Consent, provider messages and usage are append-only. They reference jobs
-- by plain uuid (no FK) so purging a job never has to rewrite them.
create table public.tryon_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  job_id uuid,
  consent_version text not null,
  provider text not null,
  ip_hash text,
  consented_at timestamptz not null default now()
);
create index tryon_consent_user_idx on public.tryon_consent_events(user_id, consented_at desc);
create trigger tryon_consent_append_only before update or delete on public.tryon_consent_events
  for each row execute function private.forbid_mutation();

create table public.tryon_provider_events (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  provider text not null,
  kind text not null check (kind in ('submitted', 'status', 'completed', 'failed', 'retry', 'expired', 'deleted')),
  provider_job_id text,
  status text,
  dedupe_key text unique,
  -- Operational metadata only: never image bytes, base64 or signed URLs.
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) < 8192),
  credits int not null default 0,
  created_at timestamptz not null default now()
);
create index tryon_provider_events_job_idx on public.tryon_provider_events(job_id);
create trigger tryon_provider_events_append_only before update or delete on public.tryon_provider_events
  for each row execute function private.forbid_mutation();

create table public.tryon_usage_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  job_id uuid,
  provider text not null,
  credits int not null check (credits >= 0),
  occurred_at timestamptz not null default now()
);
create index tryon_usage_day_idx on public.tryon_usage_ledger(occurred_at);
create trigger tryon_usage_append_only before update or delete on public.tryon_usage_ledger
  for each row execute function private.forbid_mutation();

alter table public.tryon_consent_events enable row level security;
alter table public.tryon_provider_events enable row level security;
alter table public.tryon_usage_ledger enable row level security;
grant select on public.tryon_consent_events to authenticated;
create policy "own consent events" on public.tryon_consent_events
  for select to authenticated using (user_id = (select auth.uid()));
-- Provider events and the ledger are read only through staff RPCs (no direct grants).

-- Limits live in site_settings (edited by tryon.manage through an RPC).
insert into public.site_settings (key, value, is_public) values
  ('tryon.limits', '{"enabled": true, "per_user_daily": 5, "site_daily": 200, "daily_credit_cap": 300, "alert_threshold_pct": 80, "retention_hours": 24, "max_attempts": 2, "consent_version": "2026-10-26"}', false)
on conflict (key) do nothing;

create or replace function private.tryon_limits()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select '{"enabled": false, "per_user_daily": 5, "site_daily": 200, "daily_credit_cap": 300, "alert_threshold_pct": 80, "retention_hours": 24, "max_attempts": 2, "consent_version": "2026-10-26"}'::jsonb
         || coalesce((select value from public.site_settings where key = 'tryon.limits'), '{}'::jsonb);
$$;
revoke all on function private.tryon_limits() from public;

-- Public, non-sensitive view of the feature switch (the product page uses it).
create or replace function public.tryon_public_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('enabled', (private.tryon_limits() ->> 'enabled')::boolean,
                            'retention_hours', (private.tryon_limits() ->> 'retention_hours')::int,
                            'consent_version', private.tryon_limits() ->> 'consent_version');
$$;
revoke all on function public.tryon_public_config() from public;
grant execute on function public.tryon_public_config() to anon, authenticated;

create or replace function private.tryon_credits_today()
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(credits), 0)::int from public.tryon_usage_ledger
   where occurred_at >= date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka';
$$;
revoke all on function private.tryon_credits_today() from public;

-- ---------------------------------------------------------------------------
-- Customer: create a job (consent + quotas enforced here, not in the browser)
-- ---------------------------------------------------------------------------
create or replace function public.tryon_create_job(p_variant_id uuid, p_input_path text, p_consent_version text, p_ip_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lim jsonb := private.tryon_limits();
  v_product public.products;
  v_media public.product_media;
  v_job public.tryon_jobs;
  v_provider text := 'fashn'; -- the worker records the provider it actually used when it claims the job
begin
  if v_uid is null then
    raise exception 'sign in to use try-on' using errcode = '42501', hint = 'sign_in';
  end if;
  if not (v_lim ->> 'enabled')::boolean then
    raise exception 'try-on is switched off' using errcode = 'P0001', hint = 'disabled';
  end if;
  if p_consent_version is null or p_consent_version <> (v_lim ->> 'consent_version') then
    raise exception 'consent is required' using errcode = '22023', hint = 'consent_required';
  end if;
  if p_input_path is null or p_input_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,120}$' or split_part(p_input_path, '/', 1) <> v_uid::text then
    raise exception 'invalid photo path' using errcode = '22023', hint = 'invalid_input';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'tryon-inputs' and o.name = p_input_path and o.owner_id = v_uid::text) then
    raise exception 'photo not found' using errcode = 'P0002', hint = 'photo_missing';
  end if;

  select p.* into v_product from public.products p join public.product_variants v on v.product_id = p.id
   where v.id = p_variant_id and v.is_active and p.status = 'active';
  if not found or not v_product.tryon_enabled then
    raise exception 'try-on is not available for this product' using errcode = 'P0001', hint = 'not_supported';
  end if;
  select m.* into v_media from public.product_media m where m.product_id = v_product.id and m.is_tryon_garment and m.kind = 'image'
   order by (m.variant_id = p_variant_id) desc nulls last, m.position limit 1;
  if not found then
    raise exception 'no garment reference photo' using errcode = 'P0001', hint = 'not_supported';
  end if;

  -- Quotas (counted in the database so a second tab cannot double-spend).
  if exists (select 1 from public.tryon_jobs j where j.user_id = v_uid and j.status in ('queued', 'processing')) then
    raise exception 'a try-on is already in progress' using errcode = 'P0001', hint = 'already_running';
  end if;
  if (select count(*) from public.tryon_jobs j where j.user_id = v_uid and j.created_at > now() - interval '24 hours' and j.status <> 'cancelled')
     >= (v_lim ->> 'per_user_daily')::int then
    raise exception 'daily try-on limit reached' using errcode = 'P0001', hint = 'quota_user';
  end if;
  if (select count(*) from public.tryon_jobs j where j.created_at > now() - interval '24 hours' and j.status <> 'cancelled')
     >= (v_lim ->> 'site_daily')::int then
    raise exception 'try-on is busy today' using errcode = 'P0001', hint = 'quota_site';
  end if;
  if private.tryon_credits_today() >= (v_lim ->> 'daily_credit_cap')::int then
    raise exception 'try-on budget for today is used up' using errcode = 'P0001', hint = 'quota_credits';
  end if;

  insert into public.tryon_jobs (user_id, product_variant_id, status, input_path, provider, consent_at, consent_version, ip_hash,
      garment_media_id, garment_path, settings, expires_at)
  values (v_uid, p_variant_id, 'queued', p_input_path, v_provider, now(), p_consent_version, p_ip_hash,
      v_media.id, v_media.storage_path, jsonb_build_object('category', 'auto', 'mode', 'balanced'),
      now() + make_interval(hours => (v_lim ->> 'retention_hours')::int))
  returning * into v_job;
  insert into public.tryon_consent_events (user_id, job_id, consent_version, provider, ip_hash)
  values (v_uid, v_job.id, p_consent_version, v_provider, p_ip_hash);
  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'expires_at', v_job.expires_at);
end;
$$;
revoke all on function public.tryon_create_job(uuid, text, text, text) from public;
grant execute on function public.tryon_create_job(uuid, text, text, text) to authenticated;

create or replace function public.tryon_cancel_job(p_job_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.tryon_jobs set status = 'cancelled'
     where id = p_job_id and user_id = (select auth.uid()) and status = 'queued'
     returning id)
  select exists (select 1 from u);
$$;
revoke all on function public.tryon_cancel_job(uuid) from public;
grant execute on function public.tryon_cancel_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.tryon_claim_jobs(p_limit int default 3, p_provider text default 'fashn')
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select j.* from public.tryon_jobs j
     where (j.status = 'queued' or (j.status = 'processing' and j.started_at < now() - interval '10 minutes'))
       and j.expires_at > now()
     order by j.created_at
     limit greatest(1, least(p_limit, 20))
     for update skip locked
  loop
    if p_provider not in ('mock', 'fashn') then
      raise exception 'unknown provider' using errcode = '22023';
    end if;
    update public.tryon_jobs set status = 'processing', attempts = attempts + 1, started_at = now(), error_code = null, error_message = null, provider = p_provider
     where id = r.id;
    return next jsonb_build_object('job_id', r.id, 'user_id', r.user_id, 'input_path', r.input_path, 'garment_path', r.garment_path,
      'settings', r.settings, 'attempts', r.attempts + 1, 'provider', p_provider, 'provider_job_id', r.provider_job_id,
      'variant_id', r.product_variant_id);
  end loop;
end;
$$;
revoke all on function public.tryon_claim_jobs(int, text) from public;
grant execute on function public.tryon_claim_jobs(int, text) to service_role;

create or replace function public.tryon_job_event(p_job_id uuid, p_kind text, p_dedupe_key text, p_provider_job_id text, p_status text, p_payload jsonb, p_credits int default 0)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
begin
  select provider into v_provider from public.tryon_jobs where id = p_job_id;
  if v_provider is null then
    return false;
  end if;
  if p_dedupe_key is not null and exists (select 1 from public.tryon_provider_events where dedupe_key = p_dedupe_key) then
    return false;
  end if;
  insert into public.tryon_provider_events (job_id, provider, kind, provider_job_id, status, dedupe_key, payload, credits)
  values (p_job_id, v_provider, p_kind, left(p_provider_job_id, 120), left(p_status, 40), p_dedupe_key, coalesce(p_payload, '{}'::jsonb), coalesce(p_credits, 0));
  if p_provider_job_id is not null then
    update public.tryon_jobs set provider_job_id = left(p_provider_job_id, 120) where id = p_job_id and provider_job_id is distinct from left(p_provider_job_id, 120);
  end if;
  return true;
end;
$$;
revoke all on function public.tryon_job_event(uuid, text, text, text, text, jsonb, int) from public;
grant execute on function public.tryon_job_event(uuid, text, text, text, text, jsonb, int) to service_role;

create or replace function public.tryon_complete_job(p_job_id uuid, p_output_path text, p_credits int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.tryon_jobs;
begin
  select * into j from public.tryon_jobs where id = p_job_id for update;
  if not found then
    raise exception 'unknown job' using errcode = 'P0002';
  end if;
  if j.status = 'completed' then
    return jsonb_build_object('changed', false, 'status', j.status);
  end if;
  if split_part(p_output_path, '/', 1) <> j.user_id::text then
    raise exception 'output path must be in the owner''s folder' using errcode = '22023';
  end if;
  update public.tryon_jobs set status = 'completed', output_path = p_output_path, credits = coalesce(p_credits, 0), completed_at = now(),
         error_code = null, error_message = null
   where id = j.id;
  insert into public.tryon_usage_ledger (user_id, job_id, provider, credits) values (j.user_id, j.id, j.provider, coalesce(p_credits, 0));
  insert into public.tryon_provider_events (job_id, provider, kind, provider_job_id, status, credits)
  values (j.id, j.provider, 'completed', j.provider_job_id, 'completed', coalesce(p_credits, 0));
  return jsonb_build_object('changed', true, 'status', 'completed');
end;
$$;
revoke all on function public.tryon_complete_job(uuid, text, int) from public;
grant execute on function public.tryon_complete_job(uuid, text, int) to service_role;

create or replace function public.tryon_fail_job(p_job_id uuid, p_error_code text, p_error_message text, p_retryable boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.tryon_jobs;
  v_max int := (private.tryon_limits() ->> 'max_attempts')::int;
  v_status text;
begin
  select * into j from public.tryon_jobs where id = p_job_id for update;
  if not found then
    raise exception 'unknown job' using errcode = 'P0002';
  end if;
  if j.status in ('completed', 'cancelled', 'expired') then
    return jsonb_build_object('changed', false, 'status', j.status);
  end if;
  v_status := case when p_retryable and j.attempts < v_max then 'queued' else 'failed' end;
  update public.tryon_jobs set status = v_status, error_code = left(p_error_code, 60), error_message = left(p_error_message, 300)
   where id = j.id;
  insert into public.tryon_provider_events (job_id, provider, kind, provider_job_id, status, payload)
  values (j.id, j.provider, case when v_status = 'queued' then 'retry' else 'failed' end, j.provider_job_id, left(p_error_code, 40),
          jsonb_build_object('attempt', j.attempts, 'message', left(p_error_message, 300)));
  return jsonb_build_object('changed', true, 'status', v_status);
end;
$$;
revoke all on function public.tryon_fail_job(uuid, text, text, boolean) from public;
grant execute on function public.tryon_fail_job(uuid, text, text, boolean) to service_role;

-- Expired jobs: the worker deletes the storage objects, then purges the rows.
create or replace function public.tryon_expired_jobs(p_limit int default 50)
returns table (id uuid, user_id uuid, input_path text, output_path text, status text)
language sql
security definer
set search_path = ''
as $$
  select j.id, j.user_id, j.input_path, j.output_path, j.status from public.tryon_jobs j
   where j.expires_at < now() order by j.expires_at limit greatest(1, least(p_limit, 500));
$$;
revoke all on function public.tryon_expired_jobs(int) from public;
grant execute on function public.tryon_expired_jobs(int) to service_role;

create or replace function public.tryon_purge_job(p_job_id uuid, p_reason text default 'expired')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.tryon_jobs;
begin
  select * into j from public.tryon_jobs where id = p_job_id;
  if not found then
    return false;
  end if;
  insert into public.tryon_provider_events (job_id, provider, kind, provider_job_id, status, payload)
  values (j.id, j.provider, case when p_reason = 'deleted' then 'deleted' else 'expired' end, j.provider_job_id, j.status,
          jsonb_build_object('had_output', j.output_path is not null));
  delete from public.tryon_jobs where id = j.id;
  return true;
end;
$$;
revoke all on function public.tryon_purge_job(uuid, text) from public;
grant execute on function public.tryon_purge_job(uuid, text) to service_role;

-- Safety net when no worker runs: rows past expiry are marked so the UI never
-- shows a stale "completed"; objects are removed by the next worker tick.
create or replace function private.tryon_mark_expired()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tryon_jobs set status = 'expired' where expires_at < now() and status <> 'expired';
$$;
revoke all on function private.tryon_mark_expired() from public;
select cron.schedule('tryon-mark-expired', '*/10 * * * *', 'select private.tryon_mark_expired()');

-- ---------------------------------------------------------------------------
-- Staff: operational metrics and limits (tryon.manage, aal2). No photos, no paths.
-- ---------------------------------------------------------------------------
create or replace function public.tryon_admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lim jsonb := private.tryon_limits();
  v_day timestamptz := date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka';
begin
  if not private.has_permission('tryon.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'limits', v_lim,
    'credits_today', private.tryon_credits_today(),
    'jobs_today', (select count(*) from public.tryon_jobs where created_at >= v_day),
    'by_status', (select coalesce(jsonb_object_agg(s, c), '{}'::jsonb) from (select status s, count(*) c from public.tryon_jobs group by status) x),
    'failed_24h', (select count(*) from public.tryon_provider_events where kind = 'failed' and created_at > now() - interval '24 hours'),
    'top_errors_24h', (select coalesce(jsonb_agg(jsonb_build_object('code', status, 'count', c) order by c desc), '[]'::jsonb)
                       from (select status, count(*) c from public.tryon_provider_events where kind = 'failed' and created_at > now() - interval '24 hours' group by status limit 5) e),
    'queued', (select count(*) from public.tryon_jobs where status = 'queued'),
    'processing', (select count(*) from public.tryon_jobs where status = 'processing'),
    'oldest_queued_seconds', (select coalesce(extract(epoch from now() - min(created_at)), 0)::int from public.tryon_jobs where status = 'queued'),
    'users_7d', (select count(distinct user_id) from public.tryon_jobs where created_at > now() - interval '7 days'),
    'garments', (select count(*) from public.product_media where is_tryon_garment),
    'enabled_products', (select count(*) from public.products where tryon_enabled and status = 'active'));
end;
$$;
revoke all on function public.tryon_admin_stats() from public;
grant execute on function public.tryon_admin_stats() to authenticated;

create or replace function public.admin_update_tryon_limits(p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb;
  v_old jsonb;
begin
  if not private.has_permission('tryon.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_old := private.tryon_limits();
  v_new := v_old || (p_value - 'consent_version');
  if (v_new ->> 'per_user_daily')::int not between 0 and 100 or (v_new ->> 'site_daily')::int not between 0 and 100000
     or (v_new ->> 'daily_credit_cap')::int not between 0 and 1000000 or (v_new ->> 'alert_threshold_pct')::int not between 1 and 100
     or (v_new ->> 'retention_hours')::int not between 1 and 168 or (v_new ->> 'max_attempts')::int not between 1 and 5 then
    raise exception 'limit out of range' using errcode = '22023';
  end if;
  insert into public.site_settings (key, value, is_public) values ('tryon.limits', v_new, false)
  on conflict (key) do update set value = excluded.value;
  perform private.write_audit('tryon.limits', 'site_settings', 'tryon.limits', v_old, v_new, null);
  return v_new;
end;
$$;
revoke all on function public.admin_update_tryon_limits(jsonb) from public;
grant execute on function public.admin_update_tryon_limits(jsonb) to authenticated;

-- Catalogue editors attach a garment reference photo to a product.
create or replace function public.admin_set_tryon_garment(p_product_id uuid, p_storage_path text, p_alt text, p_width int, p_height int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_permission('products.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'product-media' and name = p_storage_path) then
    raise exception 'uploaded file not found' using errcode = 'P0002';
  end if;
  update public.product_media set is_tryon_garment = false where product_id = p_product_id and is_tryon_garment;
  insert into public.product_media (product_id, kind, storage_path, alt, width, height, position, is_tryon_garment)
  values (p_product_id, 'image', p_storage_path, p_alt, p_width, p_height, 1000, true)
  returning id into v_id;
  update public.products set tryon_enabled = true where id = p_product_id;
  perform private.write_audit('product.tryon_garment', 'product', p_product_id::text, null, jsonb_build_object('media_id', v_id), null);
  return v_id;
end;
$$;
revoke all on function public.admin_set_tryon_garment(uuid, text, text, int, int) from public;
grant execute on function public.admin_set_tryon_garment(uuid, text, text, int, int) to authenticated;
