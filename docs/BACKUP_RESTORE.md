# Backup and restore

## Production plan

- **Supabase**: enable daily backups and PITR on the production project as soon as real orders exist. This is the primary recovery path (point-in-time, managed).
- **Off-site logical backup**: nightly `scripts/backup.sh` from a trusted runner to encrypted object storage outside Supabase (custom-format dump of `public`, `private`, `auth`, `storage` + a schema-only SQL copy + checksums). Encrypt before upload (age/gpg); the dump contains customer data. Retain 30 daily + 12 monthly.
- **Storage buckets**: product media is synced separately (bucket → object storage, versioned). Try-on buckets are deliberately **not** backed up: they hold short-lived personal photos that expire by policy.
- **Not in the dump**: `private.rate_limit_buckets` data (transient), pg_cron jobs (per-cluster; re-create them after a restore, see below), Supabase project settings (Auth providers, SMTP, redirect URLs: keep them in the deployment notes).
- **Restore drill**: quarterly, with `scripts/restore-drill.sh` against a staging project or a local container; record the timings in the table below. Never restore production data into a developer machine un-anonymised.

## Scripts

```bash
# Backup (pg_dump must match the server's major version; Supabase = Postgres 17)
DATABASE_URL=postgresql://... scripts/backup.sh backups/

# Drill: backup → restore into a scratch database on the same server → compare
# every public/private table's row count → smoke queries → drop the scratch DB.
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
PG_DUMP="docker exec -i supabase_db_fabriklo pg_dump" \
PG_RESTORE="docker exec -i supabase_db_fabriklo pg_restore" \
TOOL_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres \
scripts/restore-drill.sh
```

Both scripts refuse hosted Supabase URLs for the drill, and the drill needs `createdb` rights (so: staging or local, never production).

## After a real restore

1. Re-create the scheduled jobs (they are not part of a logical dump):
   ```sql
   select cron.schedule('release-expired-reservations', '* * * * *', 'select public.release_expired_reservations(500)');
   select cron.schedule('purge-old-risk-signals', '17 3 * * *', 'select private.purge_old_risk_signals()');
   select cron.schedule('tryon-mark-expired', '*/10 * * * *', 'select private.tryon_mark_expired()');
   select cron.schedule('purge-rate-limit-buckets', '23 * * * *', 'select private.purge_rate_limit_buckets()');
   ```
   plus the payment-expiry and marketing jobs from migrations 0011 and 0013 (`grep -h "cron.schedule" supabase/migrations/*.sql`).
2. Re-sync product media into the `product-media` bucket.
3. Rotate any secret that could have been in the restored environment's reach.
4. Run `npm run test:db` against the restored staging database and a smoke E2E.

## Drill log

| Date | Where | Dump size | Backup | Restore | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-10-26 | Local Supabase (Postgres 17 in Docker), seeded demo data | 760 KB | 1 s | 1 s | ✅ 65 tables, row counts identical; smoke queries OK |

Finding from the first drill: a previous run against a database that had been used for `npm run test:db` failed the restore with a foreign-key error, because the DB tests' cleanup deletes fixture products with FK triggers disabled (`session_replication_role = replica`) and leaves orphan `product_variants` rows. That is test debris, not a production path, and the drill is exactly where it should surface. Run the drill against a database that has not hosted test fixtures (or after `supabase db reset`).
