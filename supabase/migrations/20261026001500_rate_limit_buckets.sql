-- Slice 9 (hardening): shared rate-limit buckets.
--
-- The in-memory limiter in lib/security/rate-limit.ts only protects one server
-- instance. This table makes the same fixed-window counters shared across
-- instances. Keys are SHA-256 hashes computed by the app (never raw IPs or
-- emails), the RPC is service_role-only, and stale buckets are purged by
-- pg_cron. Edge/WAF rate limits still apply in front of all of this.

create table private.rate_limit_buckets (
  key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null
);
comment on table private.rate_limit_buckets is 'Fixed-window rate-limit counters keyed by app-side SHA-256 of (scope, subject). No PII.';
create index rate_limit_buckets_reset_idx on private.rate_limit_buckets (reset_at);

-- Atomic hit: one UPSERT per request, so concurrent requests never under-count.
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_reset timestamptz;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{32,64}$' then
    raise exception 'rate_limit_hit: key must be a hex digest' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'rate_limit_hit: limit out of range' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate_limit_hit: window out of range' using errcode = '22023';
  end if;

  insert into private.rate_limit_buckets as b (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set count = case when b.reset_at <= now() then 1 else b.count + 1 end,
        reset_at = case when b.reset_at <= now() then now() + make_interval(secs => p_window_seconds) else b.reset_at end
  returning b.count, b.reset_at into v_count, v_reset;

  return jsonb_build_object(
    'ok', v_count <= p_limit,
    'remaining', greatest(0, p_limit - v_count),
    'retry_after_seconds', case when v_count <= p_limit then 0 else greatest(1, ceil(extract(epoch from (v_reset - now())))::integer) end
  );
end;
$$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

create or replace function private.purge_rate_limit_buckets()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  delete from private.rate_limit_buckets where reset_at < now() - interval '1 hour';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.purge_rate_limit_buckets() from public;

select cron.schedule('purge-rate-limit-buckets', '23 * * * *', 'select private.purge_rate_limit_buckets()');
