#!/usr/bin/env bash
# Restore drill: prove a backup can be restored, and measure how long it takes.
#
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#   scripts/restore-drill.sh [path/to/backup.dump]
#
# What it does
#   1. takes a fresh backup with scripts/backup.sh (unless a dump is given);
#   2. creates an empty scratch database `fabriklo_drill` on the SAME server
#      (so it needs createdb rights; never run against production: use a
#      staging project or a local container restored from the production dump);
#   3. pg_restore into it, then compares row counts of every public/private
#      table with the source and runs a few smoke queries;
#   4. drops the scratch database and prints timings.
#
# psql is used for admin and verification; pg_dump/pg_restore must match the
# server's major version (Supabase local = Postgres 17). When the local client
# tools are older, point PG_DUMP / PG_RESTORE at the database container and
# give TOOL_URL a URL that works from inside it, e.g.
#   PG_DUMP="docker exec -i supabase_db_fabriklo pg_dump" \
#   PG_RESTORE="docker exec -i supabase_db_fabriklo pg_restore" \
#   TOOL_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL (direct connection, not the pooler)}"
case "$DATABASE_URL" in
  *supabase.co*|*pooler.supabase*) echo "refusing to run the drill against a hosted project" >&2; exit 2 ;;
esac

PSQL="${PSQL:-psql}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
TOOL_URL="${TOOL_URL:-$DATABASE_URL}"   # what pg_dump/pg_restore connect to
DRILL_DB="${DRILL_DB:-fabriklo_drill}"
to_drill() { printf '%s' "$1" | sed -E "s#/[^/?]+(\?.*)?\$#/$DRILL_DB\1#"; }
DRILL_URL="$(to_drill "$DATABASE_URL")"
DRILL_TOOL_URL="$(to_drill "$TOOL_URL")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

t0=$(date +%s)
if [ "${1:-}" ]; then
  DUMP="$1"
else
  PG_DUMP="$PG_DUMP" DATABASE_URL="$TOOL_URL" "$(dirname "$0")/backup.sh" "$WORK/backup" >/dev/null
  DUMP="$(ls "$WORK"/backup/*.dump)"
fi
t1=$(date +%s)
echo "backup:  $DUMP ($(du -h "$DUMP" | cut -f1), $((t1 - t0))s)"

# shellcheck disable=SC2086
$PSQL "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc "drop database if exists $DRILL_DB with (force)" >/dev/null
# shellcheck disable=SC2086
$PSQL "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc "create database $DRILL_DB" >/dev/null
# Extensions and the private schema are not in a filtered dump; create them first.
# shellcheck disable=SC2086
$PSQL "$DRILL_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
drop schema if exists public cascade; -- the dump recreates it
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
-- pg_cron is per-cluster and bound to one database: scheduled jobs are NOT in
-- the dump. After a real restore, re-run the `select cron.schedule(...)` lines
-- from the migrations (docs/BACKUP_RESTORE.md lists them).
SQL

t2=$(date +%s)
# The dump is restored over a pipe so PG_RESTORE can point at a container.
# shellcheck disable=SC2086
$PG_RESTORE --dbname="$DRILL_TOOL_URL" --no-owner --no-privileges --exit-on-error --single-transaction < "$DUMP"
t3=$(date +%s)
echo "restore: $((t3 - t2))s"

COUNT_SQL="select n.nspname||'.'||c.relname as t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as rows from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','private') and c.relname <> 'rate_limit_buckets' order by 1"
# shellcheck disable=SC2086
$PSQL "$DATABASE_URL" -tA -c "$COUNT_SQL" > "$WORK/src.txt"
# shellcheck disable=SC2086
$PSQL "$DRILL_URL" -tA -c "$COUNT_SQL" > "$WORK/dst.txt"
if diff -u "$WORK/src.txt" "$WORK/dst.txt" > "$WORK/diff.txt"; then
  echo "verify:  $(wc -l < "$WORK/src.txt") tables, row counts identical"
else
  echo "verify:  ROW COUNT MISMATCH" >&2
  cat "$WORK/diff.txt" >&2
  exit 1
fi

# Smoke queries: the storefront's two cheapest reads must work on the restored copy.
# shellcheck disable=SC2086
$PSQL "$DRILL_URL" -v ON_ERROR_STOP=1 -tA <<'SQL'
select 'smoke: ' || count(*) || ' theme(s), get_theme() callable' from public.themes where public.get_theme() is not distinct from public.get_theme();
select 'smoke: ' || count(*) || ' published products' from public.products where status = 'active';
select 'smoke: ' || count(*) || ' orders' from public.orders;
SQL

# shellcheck disable=SC2086
$PSQL "$DATABASE_URL" -qc "drop database if exists $DRILL_DB with (force)" >/dev/null
echo "total:   $(( $(date +%s) - t0 ))s (backup $((t1 - t0))s, restore $((t3 - t2))s)"
