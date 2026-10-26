import { NextResponse, type NextRequest } from "next/server";
import { getPaymentProvider } from "@/lib/payments";
import { formToRecord } from "@/lib/payments/http";
import { processGatewayMessage } from "@/lib/payments/service";
import { publicEnv } from "@/lib/env";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";

/**
 * Where the gateway sends the customer's browser back (success/fail/cancel).
 * Nothing here is trusted: a success return only triggers the same server-side
 * validation the IPN does. The customer always lands on /order/payment, which
 * reads the real state from the database.
 */
async function handle(req: NextRequest, ctx: RouteContext<"/api/payments/[provider]/return">) {
  const { provider: id } = await ctx.params;
  const provider = getPaymentProvider();
  const dest = new URL("/order/payment", publicEnv.NEXT_PUBLIC_SITE_URL);
  if (!provider || provider.id !== id) return NextResponse.redirect(dest, 303);
  const rl = rateLimit(`pay-return:${clientIp(req.headers)}`, 60, 60_000);
  if (rl.ok) {
    const form = await formToRecord(req);
    const outcome = req.nextUrl.searchParams.get("outcome");
    // The URL we registered says what the gateway meant; the body may omit a status.
    if (!form.status && outcome === "fail") form.status = "FAILED";
    if (!form.status && outcome === "cancel") form.status = "CANCELLED";
    if (form.tran_id) {
      const r = await processGatewayMessage(provider, "return", form).catch(() => null);
      if (r?.handled === "settled") dest.searchParams.set("order", r.orderNumber ?? "");
    }
  }
  return NextResponse.redirect(dest, 303);
}

export const POST = handle;
export const GET = handle;
