import "server-only";
import { createHash } from "node:crypto";
import { publicEnv } from "@/lib/env";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getPaymentProvider } from "./index";
import type { PaymentProvider, ValidationResult } from "./types";

const ORDER_RE = /^FBK-\d{6,10}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const TRAN_RE = /^FBK-\d{6,10}-\d{1,3}$/;

export class PaymentError extends Error {
  constructor(
    public code: "unavailable" | "not_payable" | "already_paid" | "too_many_attempts" | "not_found" | "gateway",
    message: string,
  ) {
    super(message);
  }
}

function siteUrl() {
  return publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
}

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

/** Stable fingerprint of a gateway message, for de-duplication. */
function fingerprint(form: Record<string, string>) {
  return sha256(Object.keys(form).sort().map((k) => `${k}=${form[k]}`).join("&"));
}

/**
 * Starts (or retries) an online payment for an order the caller proved they
 * own (order number + tracking token). Creates the attempt in the database,
 * then the gateway session, and returns where to send the customer.
 */
export async function startPayment(orderNumber: string, trackingToken: string): Promise<{ redirectUrl: string; tranId: string }> {
  const provider = getPaymentProvider();
  if (!provider) throw new PaymentError("unavailable", "Online payment is not available right now.");
  if (!ORDER_RE.test(orderNumber) || !TOKEN_RE.test(trackingToken)) throw new PaymentError("not_found", "Order not found.");
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.rpc("payment_begin", { p_order_number: orderNumber, p_tracking_token: trackingToken, p_provider: provider.id });
  if (error) {
    const hint = error.hint ?? "";
    if (hint === "not_payable") throw new PaymentError("not_payable", "This order is not waiting for payment.");
    if (hint === "already_paid") throw new PaymentError("already_paid", "This order is already paid.");
    if (hint === "too_many_attempts") throw new PaymentError("too_many_attempts", "Too many payment attempts for this order. Please contact us.");
    if (error.code === "P0002") throw new PaymentError("not_found", "Order not found.");
    throw new PaymentError("gateway", "We couldn't start the payment. Please try again.");
  }
  const begin = data as {
    tran_id: string; amount_minor: number; currency: "BDT"; order_id: string;
    customer: { name: string; phone: string; email: string | null; address: { address_line: string; area: string; district: string; postal_code: string | null } };
  };
  const { count } = await svc.from("order_items").select("id", { count: "exact", head: true }).eq("order_id", begin.order_id);
  const base = siteUrl();
  const session = await provider.createSession({
    tranId: begin.tran_id,
    orderNumber,
    amountMinor: Number(begin.amount_minor),
    currency: "BDT",
    customer: begin.customer,
    itemCount: count ?? 1,
    urls: {
      success: `${base}/api/payments/${provider.id}/return?outcome=success`,
      fail: `${base}/api/payments/${provider.id}/return?outcome=fail`,
      cancel: `${base}/api/payments/${provider.id}/return?outcome=cancel`,
      ipn: `${base}/api/payments/${provider.id}/ipn`,
    },
  });
  if (!session.ok) {
    await svc.rpc("payment_log_event", { p_tran_id: begin.tran_id, p_kind: "session_created", p_dedupe_key: null, p_status: "failed", p_payload: { reason: session.reason.slice(0, 300) } });
    await svc.rpc("payment_settle", { p_tran_id: begin.tran_id, p_outcome: "failed", p_amount_minor: 0, p_currency: "BDT", p_gateway_val_id: null, p_bank_tran_id: null, p_card_type: null, p_gateway_risk: null, p_payload: { reason: "session_failed" } });
    throw new PaymentError("gateway", "The payment gateway is not responding. Please try again in a moment.");
  }
  await svc.rpc("payment_session_recorded", { p_tran_id: begin.tran_id, p_session_key: session.sessionKey });
  return { redirectUrl: session.redirectUrl, tranId: begin.tran_id };
}

export type GatewayMessageResult =
  | { handled: "duplicate" }
  | { handled: "ignored"; reason: string }
  | { handled: "settled"; outcome: "valid" | "failed" | "cancelled"; orderNumber: string | null };

/**
 * One path for every message about a transaction (IPN, browser return, mock
 * callback). Logs it, de-duplicates it, then settles ONLY on the provider's
 * server-side validation of `val_id`. The message's own `status`/`amount`
 * fields are never enough to mark an order paid.
 */
export async function processGatewayMessage(
  provider: PaymentProvider,
  kind: "ipn" | "return",
  form: Record<string, string>,
): Promise<GatewayMessageResult> {
  const tranId = form.tran_id ?? "";
  if (!TRAN_RE.test(tranId)) return { handled: "ignored", reason: "bad_tran_id" };
  const svc = createSupabaseServiceClient();
  const status = (form.status ?? "").toUpperCase();
  const dedupe = `${kind}:${tranId}:${fingerprint(form)}`;
  const { data: fresh, error: logErr } = await svc.rpc("payment_log_event", {
    p_tran_id: tranId, p_kind: kind, p_dedupe_key: dedupe, p_status: status || kind, p_payload: redact(form),
  });
  if (logErr) return { handled: "ignored", reason: "log_failed" };
  if (fresh === false) return { handled: "duplicate" };

  if (kind === "ipn" && !provider.verifyIpnSignature(form)) {
    await svc.rpc("payment_log_event", { p_tran_id: tranId, p_kind: "rejected", p_dedupe_key: null, p_status: "bad_signature", p_payload: {} });
    return { handled: "ignored", reason: "bad_signature" };
  }

  // Not a success claim: close the attempt as failed/cancelled (idempotent, never pays).
  if (status !== "VALID" && status !== "VALIDATED") {
    const outcome = status === "CANCELLED" ? "cancelled" : "failed";
    if (kind === "return" && !status) {
      // A bare browser return says nothing; fail/cancel outcomes come from the query string.
      return { handled: "ignored", reason: "no_status" };
    }
    const r = await settle(svc, tranId, outcome, null, { source: kind, status });
    return { handled: "settled", outcome, orderNumber: r?.order_number ?? null };
  }

  // Success claim: ask the provider.
  const valId = form.val_id ?? "";
  if (!valId) return { handled: "ignored", reason: "no_val_id" };
  const v = await provider.validate(valId);
  await svc.rpc("payment_log_event", { p_tran_id: tranId, p_kind: "validation", p_dedupe_key: null, p_status: v.outcome, p_payload: redact(v.raw as Record<string, string>) });
  if (v.outcome === "unknown") return { handled: "ignored", reason: "validation_unknown" };
  if (v.outcome !== "valid") {
    const r = await settle(svc, tranId, v.outcome, null, { source: `${kind}+validation`, status: v.outcome });
    return { handled: "settled", outcome: v.outcome, orderNumber: r?.order_number ?? null };
  }
  if (v.tranId && v.tranId !== tranId) {
    await svc.rpc("payment_log_event", { p_tran_id: tranId, p_kind: "rejected", p_dedupe_key: null, p_status: "tran_id_mismatch", p_payload: { validated_for: v.tranId } });
    return { handled: "ignored", reason: "tran_id_mismatch" };
  }
  const r = await settle(svc, tranId, "valid", v, { source: `${kind}+validation` });
  if (!r || r.status === "rejected") return { handled: "ignored", reason: r?.reason ?? "settle_failed" };
  return { handled: "settled", outcome: "valid", orderNumber: r.order_number };
}

async function settle(
  svc: ReturnType<typeof createSupabaseServiceClient>,
  tranId: string,
  outcome: "valid" | "failed" | "cancelled",
  v: ValidationResult | null,
  payload: Record<string, unknown>,
) {
  const { data, error } = await svc.rpc("payment_settle", {
    p_tran_id: tranId,
    p_outcome: outcome,
    p_amount_minor: v?.amountMinor ?? 0,
    p_currency: v?.currency ?? "BDT",
    p_gateway_val_id: v?.valId ?? null,
    p_bank_tran_id: v?.bankTranId ?? null,
    p_card_type: v?.cardType ?? null,
    p_gateway_risk: v?.riskLevel ?? null,
    p_payload: payload,
  });
  if (error) {
    console.warn(`[payments] settle ${tranId} ${outcome} failed: ${error.hint ?? error.message}`);
    return null;
  }
  const r = data as { order_number: string; status: string; changed: boolean; reason?: string };
  // amount_mismatch / replayed_val_id: the database kept a 'rejected' event; the order stays unpaid.
  if (r.status === "rejected") console.warn(`[payments] settle ${tranId} rejected: ${r.reason}`);
  return r;
}

/** Keep gateway payloads but never store credentials echoed back in them. */
function redact(form: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (/passwd|password|secret|verify_sign/i.test(k)) continue;
    out[k] = typeof v === "string" ? v.slice(0, 500) : v;
  }
  return out;
}

export type PaymentState = {
  order_number: string;
  payment_method: "cod" | "sslcommerz";
  payment_status: string;
  total_minor: number;
  fulfillment_status: string;
  last_attempt: { status: string; provider: string; at: string } | null;
};

/** Customer-facing state (anon RPC; proves ownership with the tracking token). */
export async function getPaymentState(orderNumber: string, token: string): Promise<PaymentState | null> {
  if (!ORDER_RE.test(orderNumber) || !TOKEN_RE.test(token)) return null;
  const { data, error } = await createSupabasePublicClient().rpc("payment_status", { p_order_number: orderNumber, p_token: token });
  if (error || !data) return null;
  return data as PaymentState;
}
