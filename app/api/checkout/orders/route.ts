import { NextResponse, type NextRequest } from "next/server";
import { CheckoutError, placeOrder } from "@/lib/checkout/service";
import { placeOrderSchema } from "@/lib/checkout/schema";
import { forbiddenOrigin, jsonError, rateLimited, zodError } from "@/lib/security/http";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

const STATUS: Record<CheckoutError["code"], number> = {
  cart_missing: 404,
  cart_empty: 422,
  stock_unavailable: 409,
  no_delivery: 422,
  quote_changed: 409,
  cod_unavailable: 422,
  payment_unavailable: 422,
  invalid_input: 422,
  unknown: 500,
};

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const ip = clientIp(req.headers);
  // Orders are rarer than browsing: tight per-IP limit (edge/WAF limits apply on top in production).
  const rl = rateLimit(`order:${ip}`, 8, 10 * 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  if (Number(req.headers.get("content-length") ?? 0) > 5_000) return jsonError(413, "too_large", "Request too large.");
  const parsed = placeOrderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  try {
    const order = await placeOrder(parsed.data);
    return NextResponse.json(
      { orderNumber: order.orderNumber, replayed: order.replayed },
      { status: order.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof CheckoutError) return jsonError(STATUS[e.code], e.code, e.message);
    return jsonError(500, "unknown", "We couldn't place your order. Please try again.");
  }
}
