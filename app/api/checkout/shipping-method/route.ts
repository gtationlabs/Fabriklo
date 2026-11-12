import { NextResponse, type NextRequest } from "next/server";
import { setShippingMethod } from "@/lib/checkout/service";
import { shippingMethodRequestSchema } from "@/lib/checkout/schema";
import { forbiddenOrigin, jsonError, rateLimited, zodError } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const rl = await enforceRateLimit(`ship-method:${clientIp(req.headers)}`, 30, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  const parsed = shippingMethodRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const r = await setShippingMethod(parsed.data.code);
  if (r === "cart_missing") return jsonError(404, "cart_missing", "Your cart has expired.");
  if (r === "invalid") return jsonError(422, "invalid_method", "That delivery option is not available.");
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
