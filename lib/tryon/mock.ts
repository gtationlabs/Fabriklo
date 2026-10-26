import sharp from "sharp";
import type { TryonPoll, TryonProvider, TryonRequest, TryonSubmit } from "./types";

/**
 * Development/test stand-in for a try-on model. It does NOT dress the person:
 * it returns the customer's own photo with the garment photo inset and a loud
 * "DEMO MOCK" banner, so the whole pipeline (upload → queue → worker →
 * private result → UI) can be exercised without a provider key. Selected only
 * when no FASHN key exists and never in production without TRYON_ALLOW_MOCK.
 */
export const MOCK_TRYON_LABEL = "Demo mock (not a real try-on)";

const pending = new Map<string, { req: TryonRequest; readyAt: number }>();

export function createMockTryonProvider(delayMs = 1500): TryonProvider {
  return {
    id: "mock",
    label: MOCK_TRYON_LABEL,
    isMock: true,
    disclosure: "This is a demo mock: your photo stays on this server, no AI provider is called, and the result is your own photo with the garment shown beside it.",
    async submit(req: TryonRequest): Promise<TryonSubmit> {
      const id = `mock-${req.jobId}`;
      pending.set(id, { req, readyAt: Date.now() + delayMs });
      return { ok: true, providerJobId: id };
    },
    async poll(providerJobId: string): Promise<TryonPoll> {
      const p = pending.get(providerJobId);
      if (!p) return { state: "failed", code: "PipelineError", message: "mock job not found (server restarted)", retryable: true, raw: { mock: true } };
      if (Date.now() < p.readyAt) return { state: "pending", status: "processing" };
      pending.delete(providerJobId);
      const bytes = await renderMock(p.req);
      return { state: "completed", output: { bytes, mime: "image/jpeg" }, credits: 0, raw: { mock: true } };
    },
  };
}

async function renderMock(req: TryonRequest): Promise<Uint8Array> {
  const model = sharp(Buffer.from(req.modelImage.bytes)).rotate();
  const meta = await model.metadata();
  const width = Math.min(meta.width ?? 864, 864);
  const base = await model.resize({ width, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
  const w = base.info.width;
  const h = base.info.height;
  const inset = Math.round(w * 0.36);
  const garment = await sharp(Buffer.from(req.garmentImage.bytes)).resize({ width: inset, height: inset, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  const bannerH = Math.max(36, Math.round(h * 0.08));
  const banner = Buffer.from(
    `<svg width="${w}" height="${bannerH}"><rect width="100%" height="100%" fill="#b00020" opacity="0.92"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${Math.round(bannerH * 0.45)}" fill="#fff">DEMO MOCK · NOT A REAL TRY-ON</text></svg>`,
  );
  const out = await sharp(base.data)
    .composite([
      { input: banner, top: 0, left: 0 },
      { input: garment.data, top: h - garment.info.height - 12, left: w - garment.info.width - 12 },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(out);
}
