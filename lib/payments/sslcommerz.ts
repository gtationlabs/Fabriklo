import { createHash } from "node:crypto";
import { decimalToMinor, minorToDecimal, type PaymentProvider, type SessionRequest, type SessionResult, type ValidationResult } from "./types";

/**
 * SSLCOMMERZ hosted checkout (v4 session API + validation API).
 *
 * - The session is created server to server with the server-computed total.
 * - The browser redirect (success/fail/cancel URLs) is never trusted.
 * - A payment counts only after `validate(val_id)` returns VALID/VALIDATED with
 *   the right amount and currency, and the database re-checks those again.
 *
 * Sandbox: https://sandbox.sslcommerz.com  ·  Live: https://securepay.sslcommerz.com
 */
export type SslcommerzConfig = { storeId: string; storePassword: string; sandbox: boolean; fetchImpl?: typeof fetch };

export function sslcommerzBaseUrl(sandbox: boolean) {
  return sandbox ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com";
}

/**
 * IPN `verify_sign`: md5 over the `verify_key` fields (sorted by name), joined
 * as `k=v&`, plus `store_passwd=md5(store password)`. The validation API is
 * still the authority; the signature only filters noise early.
 */
export function computeVerifySign(form: Record<string, string>, storePassword: string): string | null {
  const keys = (form.verify_key ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  const pairs: [string, string][] = keys.map((k) => [k, form[k] ?? ""]);
  pairs.push(["store_passwd", md5(storePassword)]);
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return md5(pairs.map(([k, v]) => `${k}=${v}`).join("&"));
}

function md5(s: string) {
  return createHash("md5").update(s, "utf8").digest("hex");
}

export function createSslcommerzProvider(cfg: SslcommerzConfig): PaymentProvider {
  const base = sslcommerzBaseUrl(cfg.sandbox);
  const fetchImpl = cfg.fetchImpl ?? fetch;
  return {
    id: "sslcommerz",
    label: cfg.sandbox ? "SSLCOMMERZ (sandbox)" : "SSLCOMMERZ",
    isLive: !cfg.sandbox,
    isMock: false,

    async createSession(req: SessionRequest): Promise<SessionResult> {
      const body = new URLSearchParams({
        store_id: cfg.storeId,
        store_passwd: cfg.storePassword,
        total_amount: minorToDecimal(req.amountMinor),
        currency: req.currency,
        tran_id: req.tranId,
        success_url: req.urls.success,
        fail_url: req.urls.fail,
        cancel_url: req.urls.cancel,
        ipn_url: req.urls.ipn,
        emi_option: "0",
        cus_name: req.customer.name.slice(0, 50),
        // The gateway requires an email; a placeholder marks orders placed without one.
        cus_email: req.customer.email ?? "no-email@customer.invalid",
        cus_add1: req.customer.address.address_line.slice(0, 50),
        cus_add2: req.customer.address.area.slice(0, 50),
        cus_city: req.customer.address.district.slice(0, 50),
        cus_postcode: req.customer.address.postal_code ?? "",
        cus_country: "Bangladesh",
        cus_phone: req.customer.phone,
        shipping_method: "Courier",
        ship_name: req.customer.name.slice(0, 50),
        ship_add1: req.customer.address.address_line.slice(0, 50),
        ship_city: req.customer.address.district.slice(0, 50),
        ship_postcode: req.customer.address.postal_code ?? "",
        ship_country: "Bangladesh",
        num_of_item: String(Math.min(req.itemCount, 99)),
        product_name: `Order ${req.orderNumber}`,
        product_category: "Fashion",
        product_profile: "physical-goods",
        value_a: req.orderNumber,
      });
      let res: Response;
      try {
        res = await fetchImpl(`${base}/gwprocess/v4/api.php`, { method: "POST", body, signal: AbortSignal.timeout(15_000) });
      } catch (e) {
        return { ok: false, reason: `gateway unreachable: ${(e as Error).message}` };
      }
      const data = (await res.json().catch(() => null)) as { status?: string; GatewayPageURL?: string; sessionkey?: string; failedreason?: string } | null;
      if (!res.ok || !data || data.status !== "SUCCESS" || !data.GatewayPageURL) {
        return { ok: false, reason: data?.failedreason || `gateway returned ${res.status}` };
      }
      if (!/^https:\/\/[a-z0-9.-]+\.sslcommerz\.com\//i.test(data.GatewayPageURL)) {
        return { ok: false, reason: "gateway returned an unexpected redirect host" };
      }
      return { ok: true, redirectUrl: data.GatewayPageURL, sessionKey: data.sessionkey ?? "" };
    },

    async validate(valId: string): Promise<ValidationResult> {
      const empty: ValidationResult = { outcome: "unknown", tranId: null, amountMinor: null, currency: null, valId, bankTranId: null, cardType: null, riskLevel: null, raw: {} };
      if (!/^[A-Za-z0-9_-]{4,120}$/.test(valId)) return empty;
      const url = new URL(`${base}/validator/api/validationserverAPI.php`);
      url.searchParams.set("val_id", valId);
      url.searchParams.set("store_id", cfg.storeId);
      url.searchParams.set("store_passwd", cfg.storePassword);
      url.searchParams.set("format", "json");
      url.searchParams.set("v", "1");
      let data: Record<string, unknown> | null = null;
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
        data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      } catch {
        return empty;
      }
      if (!data) return empty;
      const str = (k: string) => (data![k] == null ? null : String(data![k]));
      const status = (str("status") ?? "").toUpperCase();
      const outcome = status === "VALID" || status === "VALIDATED" ? "valid"
        : status === "CANCELLED" ? "cancelled"
        : status === "FAILED" || status === "EXPIRED" || status === "UNATTEMPTED" || status === "INVALID_TRANSACTION" ? "failed"
        : "unknown";
      return {
        outcome,
        tranId: str("tran_id"),
        // `amount` is what the customer paid in the transaction currency (BDT for us).
        amountMinor: decimalToMinor(str("currency_amount") ?? str("amount")),
        currency: (str("currency_type") ?? str("currency") ?? "").toUpperCase() || null,
        valId: str("val_id") ?? valId,
        bankTranId: str("bank_tran_id"),
        cardType: str("card_type"),
        riskLevel: str("risk_level"),
        raw: data,
      };
    },

    verifyIpnSignature(form) {
      const expected = computeVerifySign(form, cfg.storePassword);
      const given = (form.verify_sign ?? "").toLowerCase();
      return !!expected && given.length === 32 && timingSafeEqualHex(expected, given);
    },
  };
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
