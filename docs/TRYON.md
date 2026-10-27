# AI virtual try-on

Slice 6. Provider-agnostic (`lib/tryon/types.ts`), FASHN first. Migration `0012_tryon` on top of the job table and private buckets from `0005`.

## Customer flow

1. **Availability.** The panel appears on a product page only when the product has `tryon_enabled` **and** a `product_media` row flagged `is_tryon_garment` (uploaded by a catalogue editor), the site switch `site_settings['tryon.limits'].enabled` is on, and a provider is configured. Guests see the panel but must sign in; nothing is uploaded for guests.
2. **Upload** (`POST /api/tryon/uploads`, signed-in, same-origin, rate-limited per customer and per IP). The server ignores the declared type and checks magic bytes, decodes with `sharp`, refuses < 256 px sides, extreme aspect ratios and > 10 MB, then re-encodes to JPEG with the EXIF orientation applied and **no metadata** (GPS, device, timestamps are gone), resized to at most 864 × 1296 (what FASHN processes). The file is stored with the customer's own JWT at `tryon-inputs/{user_id}/{uuid}.jpg`; bucket policies only allow the owner to read/write that folder. No public URL exists.
3. **Consent + job** (`POST /api/tryon/jobs`). `tryon_create_job` (SECURITY DEFINER, authenticated) checks: signed in; feature enabled; the consent version matches the current one; the photo path is in the caller's folder **and** exists in `storage.objects` owned by them; the variant's product is active, try-on-enabled and has a garment reference; one job in flight per customer; per-customer daily quota; site daily quota; the daily credit cap (from the usage ledger). It records a `tryon_consent_events` row (version, provider, hashed IP) and queues the job with the garment path and model settings snapshotted. Quotas are counted in the database, so parallel tabs cannot exceed them.
4. **Worker** (`lib/tryon/service.ts#runWorkerTick`, service role, never the browser). Runs right after a job is created (`after()` on the API response) and from `POST /api/tryon/worker` for a scheduler (`Authorization: Bearer $TRYON_WORKER_SECRET`, route is 404 without the secret). `tryon_claim_jobs` takes queued jobs (and processing jobs stuck > 10 min) with `FOR UPDATE SKIP LOCKED`, bumps `attempts`, records the provider used. The worker downloads the customer photo and garment, calls `provider.submit`, logs a `submitted` event with a de-duplication key, polls `provider.poll` (≤ 2 min), uploads the result to `tryon-outputs/{user_id}/{job_id}.jpg`, then `tryon_complete_job` (which refuses an output path outside the owner's folder, writes the usage ledger and a `completed` event). Failures go through `tryon_fail_job`: retryable provider errors re-queue up to `max_attempts`, others fail at once with a code that the UI maps to customer wording (never raw provider text). Image bytes and data URIs are never logged.
5. **Result** (`GET /api/tryon/jobs/[id]`, own rows via RLS): status, customer message, and **short-lived signed URLs** (10 min) for before/after. Download is offered because the customer consented and it is their own photo. The UI says plainly that it is a visualisation, not a fit guarantee.
6. **Deletion.** The customer can delete from the result view or `/account/try-on`: both objects are removed with the customer's own JWT, then `tryon_purge_job(id, 'deleted')` removes the row and leaves a `deleted` trace with no paths. **Retention**: `expires_at = created + retention_hours` (default 24 h). The worker tick purges expired jobs (objects first, then rows); a pg_cron fallback marks them `expired` every 10 minutes so stale results are never shown even if no worker runs.

## Provider: FASHN

`lib/tryon/fashn.ts` — `POST https://api.fashn.ai/v1/run` with `model_name: "tryon-v1.6"`, `inputs: { model_image, garment_image, category, garment_photo_type, mode, num_samples: 1, moderation_level: "conservative", output_format: "jpeg", return_base64: true }`; `GET /v1/status/{id}` until `completed`/`failed`; credits from the `x-fashn-credits-used` header (1 per image for this model).

Privacy choices: inputs are sent as **base64 data URIs** (FASHN documents that it keeps only a placeholder in its request history and deletes the temporary copy after processing, with a one-day backstop) and `return_base64: true` so the result is **not** published on FASHN's CDN for three days (it is readable through the status endpoint for 60 minutes; we store it immediately in our private bucket). FASHN states it does not train on customer content; it has no deletion endpoint (deletion requests go to legal@fashn.ai with prediction ids, which we keep in `tryon_provider_events`). This is what the consent text tells the customer.

Documented limits: 50 runs/min, 50 status calls/10 s, 6 concurrent. Error names mapped: `PoseError`, `ImageLoadError`, `ContentModerationError`, `InputValidationError` (final), `RateLimitExceeded`, `ConcurrencyLimitExceeded`, `ThirdPartyError`, `UnavailableError`, `PipelineError`, `InternalServerError` (retried).

**Not yet run against the real API**: the adapter is unit-tested with stubbed HTTP. It needs `FASHN_API_KEY` in the host's secret store and one real run with a real garment photo before go-live. Per-image cost in money depends on the owner's FASHN plan; the cap is expressed in credits.

## Demo mock

Without a key, outside production (or with `TRYON_ALLOW_MOCK=true`, which the Playwright server sets), `lib/tryon/mock.ts` is selected. It calls nothing: it returns the customer's photo with the garment inset and a red "DEMO MOCK · NOT A REAL TRY-ON" banner, charges 0 credits, and is labelled on the product page, the consent text, the history page and the admin. Production with no key hides the feature.

## Garment references

Catalogue editors upload a garment photo on the product's admin page (public `product-media` bucket, validated and re-encoded like customer photos, path `products/{product_id}/garment-{uuid}.jpg`); `admin_set_tryon_garment` flags it and turns `tryon_enabled` on. The seed attaches a **synthetic, labelled placeholder drawing** (`/assets/demo/garment-tee.png`, generated locally, not a photo of anyone's product) to four demo t-shirts so the flow can be exercised. Real garment photos must come from the owner.

## Budget and operations (Admin → AI try-on, `tryon.manage`, MFA)

`tryon_admin_stats()` returns counts only (credits today vs cap, jobs today, queue depth and oldest wait, failures and top error codes in 24 h, jobs by status, customers in 7 days, garments and enabled products). Staff have **no** row access to `tryon_jobs` and never see paths or photos. `admin_update_tryon_limits` edits `enabled`, `per_user_daily`, `site_daily`, `daily_credit_cap`, `alert_threshold_pct`, `retention_hours`, `max_attempts` (range-checked, audited); the consent version cannot be changed from the UI. A banner appears at the alert threshold; new jobs stop at the cap. "Run queue now" triggers a worker tick.

## Not built / limits

- No automated moderation of uploaded photos beyond the provider's own `moderation_level: "conservative"` filter and file validation; abuse reports are a later admin feature.
- No Realtime push; the panel polls every 2 s.
- Guest try-on without an account is intentionally not offered (keeps photos tied to an authenticated owner for deletion).
- Mock results exist only in server memory between submit and poll; a server restart mid-job makes the mock job retry.
