import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments";
import { formToRecord } from "@/lib/payments/http";
import { mockValId } from "@/lib/payments/mock";
import { processGatewayMessage } from "@/lib/payments/service";
import { forbiddenOrigin, jsonError } from "@/lib/security/http";
import { isSameOrigin } from "@/lib/security/request";

/**
 * The mock gateway's "bank": turns the button pressed on /pay/mock/[tranId]
 * into a fake IPN that goes through exactly the same validation path as a real
 * one. Exists only while the mock provider is selected (never with real
 * credentials, never in production unless PAYMENTS_ALLOW_MOCK=true).
 */
export async function POST(req: NextRequest) {
  const provider = getPaymentProvider();
  if (!provider || !provider.isMock) return jsonError(404, "not_found", "Mock gateway is not enabled.");
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const form = await formToRecord(req);
  const outcome = form.outcome;
  const tranId = form.tran_id ?? "";
  if (outcome !== "valid" && outcome !== "failed" && outcome !== "cancelled") return jsonError(422, "invalid_input", "Unknown outcome.");
  const status = outcome === "valid" ? "VALID" : outcome === "failed" ? "FAILED" : "CANCELLED";
  const message = { tran_id: tranId, status, val_id: mockValId(outcome, tranId), mock: "true" };
  await processGatewayMessage(provider, "ipn", message).catch(() => null);
  return NextResponse.redirect(new URL("/order/payment", publicEnv.NEXT_PUBLIC_SITE_URL), 303);
}
