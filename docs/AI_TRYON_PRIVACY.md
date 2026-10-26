# AI try-on privacy (design; storage rules already enforced)

Already in place: private `tryon-inputs` / `tryon-outputs` buckets with per-user folder policies (owner-only; staff and other customers cannot list or read), `tryon_jobs` with owner-only read/delete, a 24 h default `expires_at`, consent timestamp required, provider limited to `mock` | `fashn`.

Planned flow: explicit consent + provider disclosure → client checks (type/size, framing tips) → signed upload to `<uid>/…` → server checks magic bytes/dimensions, strips EXIF → job queued (pgmq) → worker sends the image to FASHN via short-lived signed URL or base64 (never logged) → result re-hosted privately → before/after UI with "visualisation only, not a fit guarantee" → deletion control + 24 h erasure job. Quotas per account/IP, daily spend cap, admin metrics without photo access. Mock provider is labelled as demo and never presented as a real generation. Requires `FASHN_API_KEY` (server-only).
