import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PRODUCT_PHOTO_MAX_SIDE, prepareProductPhoto } from "@/lib/media/images";
import { mediaUrl } from "@/lib/media/url";

async function png(width: number, height: number, withExif = false) {
  let img = sharp({ create: { width, height, channels: 3, background: "#5a7d9a" } });
  img = withExif ? img.jpeg().withMetadata({ exif: { IFD0: { Copyright: "Camera Co", ImageDescription: "secret location" } } }) : img.png();
  return new Uint8Array(await img.toBuffer());
}

describe("product photo preparation", () => {
  it("re-encodes to WebP within 2000 px and drops metadata", async () => {
    const res = await prepareProductPhoto(await png(3000, 2400, true));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.photo.mime).toBe("image/webp");
    expect(Math.max(res.photo.width, res.photo.height)).toBe(PRODUCT_PHOTO_MAX_SIDE);
    const meta = await sharp(Buffer.from(res.photo.bytes)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(Buffer.from(res.photo.bytes).includes("secret location")).toBe(false);
  });
  it("keeps small photos at their size", async () => {
    const res = await prepareProductPhoto(await png(800, 1000));
    expect(res.ok && res.photo.width === 800 && res.photo.height === 1000).toBe(true);
  });
  it("refuses non-images, tiny and extreme shapes", async () => {
    expect(await prepareProductPhoto(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toEqual({ ok: false, code: "unsupported_type" });
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);
    expect(await prepareProductPhoto(fakePng)).toEqual({ ok: false, code: "undecodable" });
    expect(await prepareProductPhoto(await png(300, 900))).toEqual({ ok: false, code: "too_small" });
    expect(await prepareProductPhoto(await png(500, 2000))).toEqual({ ok: false, code: "bad_aspect" });
    expect(await prepareProductPhoto(new Uint8Array(11 * 1024 * 1024))).toEqual({ ok: false, code: "too_large" });
  });
});

describe("media urls", () => {
  it("serves bucket objects from Supabase storage and local assets as-is", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    expect(mediaUrl("/assets/demo/garment-tee.png")).toBe("/assets/demo/garment-tee.png");
    expect(mediaUrl("products/abc/a b.webp")).toBe("http://127.0.0.1:54321/storage/v1/object/public/product-media/products/abc/a%20b.webp");
  });
});
