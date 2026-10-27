import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { applyCoupon, removeCoupon } from "@/lib/checkout/service";
import { forbiddenOrigin, jsonError, rateLimited, zodError } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

const schema = z.object({ code: z.string().trim().min(3).max(32) });

/** Apply a coupon to the visitor's cart. The database validates and stores it; nothing is trusted from the browser. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const rl = await enforceRateLimit(`coupon:${clientIp(req.headers)}`, 20, 10 * 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  if (Number(req.headers.get("content-length") ?? 0) > 500) return jsonError(413, "too_large", "Request too large.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const result = await applyCoupon(parsed.data.code);
  if (result === "cart_missing") return jsonError(404, "cart_missing", "Your cart has expired.");
  if (result === "too_many_attempts") return jsonError(429, "too_many_attempts", "Too many codes tried. Please wait a few minutes.");
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  await removeCoupon();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
