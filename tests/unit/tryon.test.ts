import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createFashnProvider, parseDataUri } from "@/lib/tryon/fashn";
import { preparePhoto, sniffImageType } from "@/lib/tryon/images";
import { selectTryonProvider } from "@/lib/tryon/select";
import { tryonMessageFor } from "@/lib/tryon/types";

async function photo(width: number, height: number, format: "jpeg" | "png" | "webp" = "jpeg", withExif = false) {
  let img = sharp({ create: { width, height, channels: 3, background: "#8899aa" } });
  if (withExif) img = img.withExif({ IFD0: { Copyright: "secret", ImageDescription: "gps-ish" } });
  return new Uint8Array(await img[format]().toBuffer());
}

describe("photo preparation", () => {
  it("detects real image types by content, not by name", async () => {
    expect(sniffImageType(await photo(300, 300, "jpeg"))).toBe("image/jpeg");
    expect(sniffImageType(await photo(300, 300, "png"))).toBe("image/png");
    expect(sniffImageType(await photo(300, 300, "webp"))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("re-encodes to JPEG without metadata, within the provider's size, and rejects bad inputs", async () => {
    const r = await preparePhoto(await photo(2000, 3000, "png", false));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.photo.mime).toBe("image/jpeg");
    expect(r.photo.height).toBe(1296);
    expect(r.photo.width).toBe(864);
    const meta = await sharp(Buffer.from(r.photo.bytes)).metadata();
    expect(meta.exif).toBeUndefined();

    const withExif = await preparePhoto(await photo(800, 1000, "jpeg", true));
    expect(withExif.ok).toBe(true);
    if (withExif.ok) expect((await sharp(Buffer.from(withExif.photo.bytes)).metadata()).exif).toBeUndefined();

    expect((await preparePhoto(await photo(100, 400))).ok).toBe(false);
    expect((await preparePhoto(await photo(300, 3000))).ok).toBe(false);
    expect((await preparePhoto(new Uint8Array(20).fill(1))).ok).toBe(false);
    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(await preparePhoto(huge)).toEqual({ ok: false, code: "too_large" });
  });
});

describe("provider selection", () => {
  it("uses FASHN with a key, the mock only outside production, nothing otherwise", () => {
    expect(selectTryonProvider({ FASHN_API_KEY: "k", NODE_ENV: "production" })).toBe("fashn");
    expect(selectTryonProvider({ NODE_ENV: "development" })).toBe("mock");
    expect(selectTryonProvider({ NODE_ENV: "production" })).toBeNull();
    expect(selectTryonProvider({ NODE_ENV: "production", TRYON_ALLOW_MOCK: "true" })).toBe("mock");
  });
  it("maps provider error codes to customer wording without leaking provider text", () => {
    expect(tryonMessageFor("PoseError")).toMatch(/pose/i);
    expect(tryonMessageFor("ContentModerationError")).toMatch(/safety/i);
    expect(tryonMessageFor("SomethingInternal: stack trace")).not.toMatch(/stack/);
  });
});

describe("FASHN adapter (fetch stubbed)", () => {
  const model = { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" as const };
  const garment = { bytes: new Uint8Array([4, 5]), mime: "image/png" };

  it("submits base64 inputs with base64 output requested, and never a public URL", async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")), auth: h.get("authorization") });
      return new Response(JSON.stringify({ id: "pred_123", error: null }));
    }) as typeof fetch;
    const p = createFashnProvider({ apiKey: "KEY", fetchImpl });
    const r = await p.submit({ jobId: "j1", modelImage: model, garmentImage: garment, settings: { mode: "quality" } });
    expect(r).toEqual({ ok: true, providerJobId: "pred_123" });
    expect(calls[0]!.url).toBe("https://api.fashn.ai/v1/run");
    expect(calls[0]!.auth).toBe("Bearer KEY");
    const inputs = calls[0]!.body.inputs as Record<string, unknown>;
    expect(inputs.model_image).toBe("data:image/jpeg;base64,AQID");
    expect(inputs.garment_image).toBe("data:image/png;base64,BAU=");
    expect(inputs.return_base64).toBe(true);
    expect(inputs.mode).toBe("quality");
    expect(inputs.num_samples).toBe(1);
    expect(calls[0]!.body.model_name).toBe("tryon-v1.6");
  });

  it("classifies API errors as retryable or not", async () => {
    const mk = (status: number, body: unknown) => createFashnProvider({ apiKey: "k", fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch });
    const req = { jobId: "j", modelImage: model, garmentImage: garment, settings: {} };
    expect(await mk(429, { error: { name: "RateLimitExceeded", message: "slow down" } }).submit(req)).toMatchObject({ ok: false, code: "RateLimitExceeded", retryable: true });
    expect(await mk(401, { error: { name: "UnauthorizedAccess", message: "bad key" } }).submit(req)).toMatchObject({ ok: false, code: "UnauthorizedAccess", retryable: false });
    expect(await mk(402, { error: { name: "OutOfCredits", message: "" } }).submit(req)).toMatchObject({ ok: false, code: "OutOfCredits", retryable: false });
    const down = createFashnProvider({ apiKey: "k", fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as typeof fetch });
    expect(await down.submit(req)).toMatchObject({ ok: false, code: "unavailable", retryable: true });
  });

  it("polls status: pending, completed with decoded output + credits header, failed with provider error name", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).png().toBuffer();
    const answers: Record<string, () => Response> = {
      pred_1: () => new Response(JSON.stringify({ id: "pred_1", status: "in_queue", output: null, error: null })),
      pred_2: () => new Response(JSON.stringify({ id: "pred_2", status: "completed", output: [`data:image/png;base64,${png.toString("base64")}`], error: null }), { headers: { "x-fashn-credits-used": "1" } }),
      pred_3: () => new Response(JSON.stringify({ id: "pred_3", status: "failed", output: null, error: { name: "PoseError", message: "no pose" } })),
      pred_4: () => new Response(JSON.stringify({ id: "pred_4", status: "completed", output: ["https://cdn.example/out.png"], error: null })),
    };
    const p = createFashnProvider({ apiKey: "k", fetchImpl: (async (url: RequestInfo | URL) => answers[String(url).split("/").pop()!]!()) as typeof fetch });
    expect(await p.poll("pred_1")).toEqual({ state: "pending", status: "in_queue" });
    const done = await p.poll("pred_2");
    expect(done.state).toBe("completed");
    if (done.state === "completed") {
      expect(done.credits).toBe(1);
      expect(done.output.mime).toBe("image/png");
      expect(Buffer.from(done.output.bytes).equals(png)).toBe(true);
    }
    expect(await p.poll("pred_3")).toMatchObject({ state: "failed", code: "PoseError", retryable: false });
    // A CDN URL instead of base64 is not accepted (we asked for base64 so nothing is published).
    expect(await p.poll("pred_4")).toMatchObject({ state: "failed", code: "PipelineError" });
    expect(parseDataUri("data:text/html;base64,PGI+")).toBeNull();
  });
});
