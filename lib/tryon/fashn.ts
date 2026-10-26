import type { TryonPoll, TryonProvider, TryonRequest, TryonSubmit } from "./types";

/**
 * FASHN virtual try-on (https://api.fashn.ai, model `tryon-v1.6`).
 *
 * Transport choices made for privacy:
 * - inputs are sent as base64 data URIs: FASHN keeps only a placeholder in
 *   its request history and deletes the temporary copy after processing;
 * - `return_base64: true` so the output is NOT published on FASHN's CDN for
 *   three days; it is readable through the status endpoint for 60 minutes and
 *   we store it in our private bucket immediately.
 * Documented limits: /v1/run 50 req/min, /v1/status 50 req/10 s, 6 concurrent.
 */
export type FashnConfig = { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string };

const RETRYABLE = new Set(["RateLimitExceeded", "ConcurrencyLimitExceeded", "ThirdPartyError", "UnavailableError", "InternalServerError", "PipelineError"]);

export function createFashnProvider(cfg: FashnConfig): TryonProvider {
  const base = (cfg.baseUrl ?? "https://api.fashn.ai").replace(/\/$/, "");
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" };

  return {
    id: "fashn",
    label: "FASHN",
    isMock: false,
    disclosure:
      "Your photo and the garment photo are sent to FASHN (fashn.ai) to generate the image. They are transferred as data, not links; FASHN deletes its temporary copy after processing and keeps only a record of the request, not the photos. FASHN states it does not use customer images to train models.",

    async submit(req: TryonRequest): Promise<TryonSubmit> {
      const body = {
        model_name: "tryon-v1.6",
        inputs: {
          model_image: dataUri(req.modelImage.mime, req.modelImage.bytes),
          garment_image: dataUri(req.garmentImage.mime, req.garmentImage.bytes),
          category: req.settings.category ?? "auto",
          garment_photo_type: req.settings.garmentPhotoType ?? "auto",
          mode: req.settings.mode ?? "balanced",
          num_samples: 1,
          moderation_level: "conservative",
          output_format: "jpeg",
          return_base64: true,
        },
      };
      let res: Response;
      try {
        res = await fetchImpl(`${base}/v1/run`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        return { ok: false, code: "unavailable", message: `FASHN unreachable: ${(e as Error).message}`, retryable: true };
      }
      const data = (await res.json().catch(() => null)) as { id?: string; error?: { name?: string; message?: string } | string | null } | null;
      if (!res.ok || !data?.id) {
        const name = typeof data?.error === "object" && data?.error ? data.error.name ?? "" : "";
        const code = name || (res.status === 401 ? "UnauthorizedAccess" : res.status === 429 ? "RateLimitExceeded" : `http_${res.status}`);
        return { ok: false, code, message: safeMessage(data?.error) || `FASHN returned ${res.status}`, retryable: RETRYABLE.has(code) || res.status >= 500 };
      }
      return { ok: true, providerJobId: data.id };
    },

    async poll(providerJobId: string): Promise<TryonPoll> {
      if (!/^[A-Za-z0-9_-]{4,120}$/.test(providerJobId)) return { state: "failed", code: "InputValidationError", message: "bad prediction id", retryable: false, raw: {} };
      let res: Response;
      try {
        res = await fetchImpl(`${base}/v1/status/${encodeURIComponent(providerJobId)}`, { headers: { Authorization: headers.Authorization }, signal: AbortSignal.timeout(20_000) });
      } catch {
        return { state: "pending", status: "unreachable" };
      }
      const data = (await res.json().catch(() => null)) as { id?: string; status?: string; output?: string[] | null; error?: { name?: string; message?: string } | string | null } | null;
      if (!res.ok || !data) {
        if (res.status === 429 || res.status >= 500) return { state: "pending", status: `http_${res.status}` };
        return { state: "failed", code: `http_${res.status}`, message: `status endpoint returned ${res.status}`, retryable: res.status >= 500, raw: {} };
      }
      const credits = Number(res.headers.get("x-fashn-credits-used") ?? "") || 1;
      const raw = { status: data.status, credits_used: res.headers.get("x-fashn-credits-used") };
      if (data.status === "completed") {
        const first = data.output?.[0];
        const parsed = first ? parseDataUri(first) : null;
        if (!parsed) return { state: "failed", code: "PipelineError", message: "completed without a readable output", retryable: true, raw };
        return { state: "completed", output: parsed, credits, raw };
      }
      if (data.status === "failed") {
        const name = (typeof data.error === "object" && data.error?.name) || "PipelineError";
        return { state: "failed", code: name, message: safeMessage(data.error), retryable: RETRYABLE.has(name), raw: { ...raw, error: name } };
      }
      return { state: "pending", status: data.status ?? "unknown" };
    },
  };
}

function dataUri(mime: string, bytes: Uint8Array) {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function parseDataUri(uri: string): { bytes: Uint8Array; mime: "image/png" | "image/jpeg" } | null {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  if (!m) return null;
  return { mime: m[1] as "image/png" | "image/jpeg", bytes: new Uint8Array(Buffer.from(m[2]!, "base64")) };
}

/** Provider messages are kept short and never echoed to customers verbatim. */
function safeMessage(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err.slice(0, 200);
  const m = (err as { message?: string }).message;
  return typeof m === "string" ? m.slice(0, 200) : "";
}
