import { NextResponse, type NextRequest } from "next/server";
import { lastOrderFromCookie } from "@/lib/checkout/service";
import { publicEnv } from "@/lib/env";
import { PaymentError, startPayment } from "@/lib/payments/service";
import { forbiddenOrigin } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

/** "Try paying again": a plain form POST, proven by the checkout receipt cookie. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const dest = new URL("/order/payment", publicEnv.NEXT_PUBLIC_SITE_URL);
  const rl = await enforceRateLimit(`pay-retry:${clientIp(req.headers)}`, 10, 10 * 60_000);
  if (!rl.ok) {
    dest.searchParams.set("error", "Too many attempts. Please wait a few minutes.");
    return NextResponse.redirect(dest, 303);
  }
  const receipt = await lastOrderFromCookie();
  if (!receipt) return NextResponse.redirect(dest, 303);
  try {
    const { redirectUrl } = await startPayment(receipt.orderNumber, receipt.token);
    return NextResponse.redirect(redirectUrl, 303);
  } catch (e) {
    dest.searchParams.set("error", e instanceof PaymentError ? e.message : "We couldn't start the payment.");
    return NextResponse.redirect(dest, 303);
  }
}
