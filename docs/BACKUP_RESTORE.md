# Backup and restore (plan)

- Production Supabase: enable daily backups and PITR (Pro plan add-on) once revenue data exists.
- Off-site: nightly `pg_dump` of the database (schema + data, excluding `auth` secrets where policy requires) to encrypted object storage outside Supabase; storage buckets synced separately (product-media fully; try-on buckets excluded because they hold short-lived personal photos by design).
- Restore drill each quarter into a staging project: restore DB, re-sync product media, run `npm run test:db` + E2E against staging, record timings in this file.
- Never restore production data into local/dev environments without anonymisation.
