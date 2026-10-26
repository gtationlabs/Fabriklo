#!/usr/bin/env bash
# Logical backup of the Fabriklo database (schema + data) plus a schema-only
# copy, as compressed pg_dump custom-format archives.
#
#   DATABASE_URL=postgresql://... scripts/backup.sh [out-dir]
#
# Notes
# - pg_dump must be >= the server's major version (Supabase runs Postgres 17).
#   Set PG_DUMP to another binary, or to a container prefix such as
#   PG_DUMP="docker exec -i supabase_db_fabriklo pg_dump" (then DATABASE_URL
#   must be reachable from inside that container, e.g. 127.0.0.1:5432).
# - Excluded on purpose: try-on photo metadata rows are kept (they expire by
#   policy) but the storage buckets are NOT part of this dump. Product media is
#   synced separately (see docs/BACKUP_RESTORE.md).
# - The dump contains customer data: encrypt at rest (age/gpg) before uploading
#   anywhere, and never restore it into a developer machine un-anonymised.
set -euo pipefail

OUT_DIR="${1:-backups}"
: "${DATABASE_URL:?set DATABASE_URL (direct connection, not the pooler)}"
PG_DUMP="${PG_DUMP:-pg_dump}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"

DATA="$OUT_DIR/fabriklo-$STAMP.dump"
SCHEMA="$OUT_DIR/fabriklo-$STAMP.schema.sql"

echo "→ full dump: $DATA"
# shellcheck disable=SC2086
$PG_DUMP "$DATABASE_URL" \
  --format=custom --compress=6 --no-owner --no-privileges \
  --schema=public --schema=private --schema=auth --schema=storage \
  --exclude-table-data='private.rate_limit_buckets' \
  > "$DATA"

echo "→ schema only: $SCHEMA"
# shellcheck disable=SC2086
$PG_DUMP "$DATABASE_URL" --schema-only --no-owner --no-privileges \
  --schema=public --schema=private > "$SCHEMA"

sha256sum "$DATA" "$SCHEMA" > "$OUT_DIR/fabriklo-$STAMP.sha256"
echo "✓ done"
ls -la "$DATA" "$SCHEMA"
