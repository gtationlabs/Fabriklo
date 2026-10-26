import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { runAutomationTick } from "@/lib/automation/service";
import { CheckoutError, placeOrder } from "@/lib/checkout/service";
import { placeOrderSchema } from "@/lib/checkout/schema";
import { PaymentError, startPayment } from "@/lib/payments/service";
import { forbiddenOrigin, jsonError, rateLimited, zodError } from "@/lib/security/http";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

const STATUS: Record<CheckoutError["code"], number> = {
  cart_missing: 404,
  cart_empty: 422,
  stock_unavailable: 409,
  no_delivery: 422,
  quote_changed: 409,
  coupon_invalid: 409,
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
    const headers = { "Cache-Control": "no-store" };
    // Order events (confirmation mail, alerts) are processed by the automation worker after the response.
    if (!order.replayed) after(() => runAutomationTick({ events: 100, messages: 20 }).catch(() => undefined));
    if (order.paymentMethod === "sslcommerz" && order.paymentStatus === "awaiting_payment") {
      // The order exists (stock on hold). Start the gateway session server-side and send the customer there.
      try {
        const { redirectUrl } = await startPayment(order.orderNumber, order.trackingToken);
        return NextResponse.json({ orderNumber: order.orderNumber, replayed: order.replayed, redirectUrl }, { status: order.replayed ? 200 : 201, headers });
      } catch (e) {
        // The order is kept: the payment result page offers a retry.
        const msg = e instanceof PaymentError ? e.message : "We couldn't start the payment.";
        return NextResponse.json({ orderNumber: order.orderNumber, replayed: order.replayed, redirectUrl: "/order/payment", paymentError: msg }, { status: 201, headers });
      }
    }
    return NextResponse.json(
      { orderNumber: order.orderNumber, replayed: order.replayed, redirectUrl: order.paymentMethod === "cod" ? "/order/success" : "/order/payment" },
      { status: order.replayed ? 200 : 201, headers },
    );
  } catch (e) {
    if (e instanceof CheckoutError) return jsonError(STATUS[e.code], e.code, e.message);
    return jsonError(500, "unknown", "We couldn't place your order. Please try again.");
  }
}
