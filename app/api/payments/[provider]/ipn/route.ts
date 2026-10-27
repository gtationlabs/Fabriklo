import { NextResponse, type NextRequest } from "next/server";
import { getPaymentProvider } from "@/lib/payments";
import { processGatewayMessage } from "@/lib/payments/service";
import { formToRecord } from "@/lib/payments/http";
import { jsonError, rateLimited } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";

/**
 * Gateway → server notification (IPN). Reached without cookies or a browser,
 * so there is no origin check; instead every message is logged, de-duplicated
 * and validated against the gateway before anything changes. Always answers
 * quickly with 200 for messages it recorded so the gateway stops retrying.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/payments/[provider]/ipn">) {
  const { provider: id } = await ctx.params;
  const provider = getPaymentProvider();
  if (!provider || provider.id !== id || provider.isMock) return jsonError(404, "not_found", "Unknown payment provider.");
  const rl = await enforceRateLimit(`ipn:${clientIp(req.headers)}`, 120, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  if (Number(req.headers.get("content-length") ?? 0) > 20_000) return jsonError(413, "too_large", "Request too large.");
  const form = await formToRecord(req);
  const result = await processGatewayMessage(provider, "ipn", form);
  if (result.handled === "ignored") return jsonError(400, result.reason, "Notification not accepted.");
  return NextResponse.json({ ok: true, handled: result.handled }, { headers: { "Cache-Control": "no-store" } });
}
