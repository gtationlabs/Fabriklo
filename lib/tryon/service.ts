import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getTryonProvider } from "./index";
import { preparePhoto, type PrepareError } from "./images";
import type { TryonProvider } from "./types";

const INPUTS = "tryon-inputs";
const OUTPUTS = "tryon-outputs";
const SIGNED_URL_SECONDS = 600;
const UUID_RE = /^[0-9a-f-]{36}$/;

export type TryonJobView = {
  id: string;
  status: string;
  product_variant_id: string;
  provider: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string;
  input_url: string | null;
  output_url: string | null;
};

export class TryonError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const CREATE_MESSAGES: Record<string, [number, string]> = {
  sign_in: [401, "Sign in to use try-on."],
  disabled: [503, "Try-on is switched off right now."],
  consent_required: [422, "Please agree to the photo processing terms first."],
  invalid_input: [422, "Upload a photo first."],
  photo_missing: [404, "Your photo was not found. Please upload it again."],
  not_supported: [422, "Try-on isn't available for this product."],
  already_running: [409, "You already have a try-on in progress. Wait for it to finish."],
  quota_user: [429, "You've reached today's try-on limit. Please come back tomorrow."],
  quota_site: [429, "Try-on is busy today. Please try again tomorrow."],
  quota_credits: [429, "Try-on is temporarily unavailable. Please try again tomorrow."],
};

export function hashIp(ip: string) {
  return createHash("sha256").update(`tryon:${ip}`).digest("hex");
}

/** Validates, strips metadata and stores the customer's photo in their private folder. */
export async function uploadPhoto(userId: string, bytes: Uint8Array): Promise<{ path: string; width: number; height: number } | { error: PrepareError }> {
  const prepared = await preparePhoto(bytes);
  if (!prepared.ok) return { error: prepared.code };
  const objectPath = `${userId}/${randomUUID()}.jpg`;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage.from(INPUTS).upload(objectPath, Buffer.from(prepared.photo.bytes), { contentType: "image/jpeg", upsert: false });
  if (error) throw new TryonError("storage", "We couldn't save your photo. Please try again.", 500);
  return { path: objectPath, width: prepared.photo.width, height: prepared.photo.height };
}

export async function createJob(variantId: string, inputPath: string, consentVersion: string, ipHash: string): Promise<{ jobId: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("tryon_create_job", { p_variant_id: variantId, p_input_path: inputPath, p_consent_version: consentVersion, p_ip_hash: ipHash });
  if (error) {
    const hint = error.hint ?? "";
    const [status, message] = CREATE_MESSAGES[hint] ?? [500, "We couldn't start the try-on. Please try again."];
    throw new TryonError(hint || "unknown", message, status);
  }
  return { jobId: (data as { job_id: string }).job_id };
}

/** The caller's own job (RLS), with short-lived signed URLs for their private images. */
export async function getJob(id: string): Promise<TryonJobView | null> {
  if (!UUID_RE.test(id)) return null;
  const supabase = await createSupabaseServerClient();
  const { data: j } = await supabase
    .from("tryon_jobs")
    .select("id, status, product_variant_id, provider, error_code, error_message, created_at, completed_at, expires_at, input_path, output_path")
    .eq("id", id)
    .maybeSingle();
  if (!j) return null;
  const sign = async (bucket: string, p: string | null) => {
    if (!p) return null;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(p, SIGNED_URL_SECONDS);
    return data?.signedUrl ?? null;
  };
  const expired = new Date(j.expires_at).getTime() < Date.now();
  return {
    id: j.id,
    status: expired ? "expired" : j.status,
    product_variant_id: j.product_variant_id,
    provider: j.provider,
    error_code: j.error_code,
    error_message: j.error_message,
    created_at: j.created_at,
    completed_at: j.completed_at,
    expires_at: j.expires_at,
    input_url: expired ? null : await sign(INPUTS, j.input_path),
    output_url: expired || j.status !== "completed" ? null : await sign(OUTPUTS, j.output_path),
  };
}

export async function listMyJobs(): Promise<TryonJobView[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("tryon_jobs")
    .select("id, status, product_variant_id, provider, error_code, error_message, created_at, completed_at, expires_at, output_path, variant:product_variants(product:products(title, slug))")
    .order("created_at", { ascending: false })
    .limit(20);
  const out: TryonJobView[] = [];
  for (const j of data ?? []) {
    const expired = new Date(j.expires_at).getTime() < Date.now();
    let output_url: string | null = null;
    if (!expired && j.status === "completed" && j.output_path) {
      const { data: s } = await supabase.storage.from(OUTPUTS).createSignedUrl(j.output_path, SIGNED_URL_SECONDS);
      output_url = s?.signedUrl ?? null;
    }
    const variant = j.variant as unknown as { product: { title: string; slug: string } | null } | null;
    out.push({
      id: j.id, status: expired ? "expired" : j.status, product_variant_id: j.product_variant_id, provider: j.provider,
      error_code: j.error_code, error_message: j.error_message, created_at: j.created_at, completed_at: j.completed_at, expires_at: j.expires_at,
      input_url: null, output_url,
      ...(variant?.product ? { product: variant.product } : {}),
    } as TryonJobView & { product?: { title: string; slug: string } });
  }
  return out;
}

/** Erases the caller's job: both photos first, then the record (an operational trace without paths remains). */
export async function deleteJob(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const supabase = await createSupabaseServerClient();
  const { data: j } = await supabase.from("tryon_jobs").select("id, input_path, output_path, status").eq("id", id).maybeSingle();
  if (!j) return false;
  await supabase.storage.from(INPUTS).remove([j.input_path]);
  if (j.output_path) await supabase.storage.from(OUTPUTS).remove([j.output_path]);
  // Purge through the trusted path so the deletion is logged (the row's RLS delete would also work).
  const { data: purged } = await createSupabaseServiceClient().rpc("tryon_purge_job", { p_job_id: id, p_reason: "deleted" });
  return purged === true;
}

// ---------------------------------------------------------------------------
// Worker: runs on the trusted server (never in the browser).
// ---------------------------------------------------------------------------
const POLL_MS = 2000;
const MAX_WAIT_MS = 120_000;
let ticking = false;

export type WorkerReport = { claimed: number; completed: number; failed: number; retried: number; purged: number; skipped?: string };

/**
 * Claims queued jobs, runs each through the provider, stores results in the
 * owner's private output folder, and purges expired jobs (objects first, then
 * rows). Single-flight per process; safe to call from a cron and after a
 * job is created.
 */
export async function runWorkerTick(limit = 3): Promise<WorkerReport> {
  const report: WorkerReport = { claimed: 0, completed: 0, failed: 0, retried: 0, purged: 0 };
  if (ticking) return { ...report, skipped: "busy" };
  const provider = getTryonProvider();
  if (!provider) return { ...report, skipped: "no_provider" };
  ticking = true;
  try {
    const svc = createSupabaseServiceClient();
    const { data: claimed, error } = await svc.rpc("tryon_claim_jobs", { p_limit: limit, p_provider: provider.id });
    if (error) throw error;
    const jobs = (claimed ?? []) as ClaimedJob[];
    report.claimed = jobs.length;
    for (const job of jobs) {
      const r = await processJob(svc, provider, job);
      report[r] += 1;
    }
    report.purged = await purgeExpired(svc);
  } finally {
    ticking = false;
  }
  return report;
}

type ClaimedJob = { job_id: string; user_id: string; input_path: string; garment_path: string | null; settings: Record<string, string>; attempts: number; provider: string; provider_job_id: string | null };

async function processJob(svc: ReturnType<typeof createSupabaseServiceClient>, provider: TryonProvider, job: ClaimedJob): Promise<"completed" | "failed" | "retried"> {
  const fail = async (code: string, message: string, retryable: boolean) => {
    const { data } = await svc.rpc("tryon_fail_job", { p_job_id: job.job_id, p_error_code: code, p_error_message: message, p_retryable: retryable });
    return (data as { status?: string } | null)?.status === "queued" ? ("retried" as const) : ("failed" as const);
  };
  try {
    const model = await downloadInput(svc, job.input_path);
    if (!model) return fail("ImageLoadError", "customer photo missing", false);
    const garment = job.garment_path ? await loadGarment(svc, job.garment_path) : null;
    if (!garment) return fail("ImageLoadError", "garment reference missing", false);

    const submitted = await provider.submit({
      jobId: job.job_id,
      modelImage: { bytes: model, mime: "image/jpeg" },
      garmentImage: garment,
      settings: { category: job.settings.category as never, mode: job.settings.mode as never },
    });
    await svc.rpc("tryon_job_event", {
      p_job_id: job.job_id, p_kind: "submitted", p_dedupe_key: `submit:${job.job_id}:${job.attempts}`,
      p_provider_job_id: submitted.ok ? submitted.providerJobId : null, p_status: submitted.ok ? "submitted" : submitted.code,
      p_payload: submitted.ok ? {} : { message: submitted.message.slice(0, 200) }, p_credits: 0,
    });
    if (!submitted.ok) return fail(submitted.code, submitted.message, submitted.retryable);

    const started = Date.now();
    while (Date.now() - started < MAX_WAIT_MS) {
      const polled = await provider.poll(submitted.providerJobId);
      if (polled.state === "completed") {
        const outputPath = `${job.user_id}/${job.job_id}.${polled.output.mime === "image/png" ? "png" : "jpg"}`;
        const { error } = await svc.storage.from(OUTPUTS).upload(outputPath, Buffer.from(polled.output.bytes), { contentType: polled.output.mime, upsert: true });
        if (error) return fail("storage", error.message, true);
        await svc.rpc("tryon_job_event", { p_job_id: job.job_id, p_kind: "status", p_dedupe_key: `done:${job.job_id}:${submitted.providerJobId}`, p_provider_job_id: submitted.providerJobId, p_status: "completed", p_payload: polled.raw, p_credits: polled.credits });
        await svc.rpc("tryon_complete_job", { p_job_id: job.job_id, p_output_path: outputPath, p_credits: polled.credits });
        return "completed";
      }
      if (polled.state === "failed") return fail(polled.code, polled.message, polled.retryable);
      await new Promise((r) => setTimeout(r, provider.isMock ? 300 : POLL_MS));
    }
    return fail("timeout", "provider did not finish in time", true);
  } catch (e) {
    return fail("unavailable", (e as Error).message.slice(0, 200), true);
  }
}

async function downloadInput(svc: ReturnType<typeof createSupabaseServiceClient>, objectPath: string): Promise<Uint8Array | null> {
  const { data, error } = await svc.storage.from(INPUTS).download(objectPath);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Garment photos are either public product-media objects or same-origin /assets files. */
async function loadGarment(svc: ReturnType<typeof createSupabaseServiceClient>, p: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (p.startsWith("/assets/")) {
    const file = path.join(process.cwd(), "public", path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, ""));
    if (!file.startsWith(path.join(process.cwd(), "public", "assets"))) return null;
    try {
      const bytes = new Uint8Array(await readFile(file));
      return { bytes, mime: p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg" };
    } catch {
      return null;
    }
  }
  const { data, error } = await svc.storage.from("product-media").download(p);
  if (error || !data) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || "image/jpeg" };
}

async function purgeExpired(svc: ReturnType<typeof createSupabaseServiceClient>): Promise<number> {
  const { data } = await svc.rpc("tryon_expired_jobs", { p_limit: 50 });
  let n = 0;
  for (const j of (data ?? []) as { id: string; input_path: string; output_path: string | null }[]) {
    const [a, b] = await Promise.all([
      svc.storage.from(INPUTS).remove([j.input_path]),
      j.output_path ? svc.storage.from(OUTPUTS).remove([j.output_path]) : Promise.resolve({ error: null }),
    ]);
    if (a.error || b.error) continue; // keep the row so the next tick retries the deletion
    const { data: ok } = await svc.rpc("tryon_purge_job", { p_job_id: j.id, p_reason: "expired" });
    if (ok) n += 1;
  }
  return n;
}
