import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseGenericWebhook, verifyHmacWebhook } from "@/lib/couriers/registry";
import { selectProvider } from "@/lib/payments/select";
import { computeVerifySign, createSslcommerzProvider } from "@/lib/payments/sslcommerz";
import { decimalToMinor, minorToDecimal } from "@/lib/payments/types";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

describe("money conversion for gateways", () => {
  it("round-trips decimal strings and integer minor units", () => {
    expect(decimalToMinor("1234.50")).toBe(123450);
    expect(decimalToMinor("1234")).toBe(123400);
    expect(decimalToMinor("0.5")).toBe(50);
    expect(decimalToMinor("1,234.50")).toBe(123450);
    expect(minorToDecimal(123450)).toBe("1234.50");
    expect(minorToDecimal(7)).toBe("0.07");
  });
  it("refuses malformed amounts instead of guessing", () => {
    expect(decimalToMinor("12.345")).toBeNull();
    expect(decimalToMinor("1e5")).toBeNull();
    expect(decimalToMinor("-5")).toBeNull();
    expect(decimalToMinor("")).toBeNull();
    expect(() => minorToDecimal(12.5)).toThrow();
  });
});

describe("SSLCOMMERZ IPN signature", () => {
  const passwd = "test-store-password";
  const form = { tran_id: "FBK-000123-1", amount: "2570.00", status: "VALID", val_id: "2510261200001", verify_key: "amount,status,tran_id,val_id" };
  const expected = md5(["amount=2570.00", "status=VALID", `store_passwd=${md5(passwd)}`, "tran_id=FBK-000123-1", "val_id=2510261200001"].join("&"));

  it("matches the documented algorithm (sorted key=value pairs + hashed store password)", () => {
    expect(computeVerifySign(form, passwd)).toBe(expected);
  });
  it("accepts a correctly signed message and rejects tampering or a missing key list", () => {
    const p = createSslcommerzProvider({ storeId: "s", storePassword: passwd, sandbox: true });
    expect(p.verifyIpnSignature({ ...form, verify_sign: expected })).toBe(true);
    expect(p.verifyIpnSignature({ ...form, amount: "1.00", verify_sign: expected })).toBe(false);
    expect(p.verifyIpnSignature({ ...form, verify_sign: "deadbeef" })).toBe(false);
    expect(p.verifyIpnSignature({ ...form, verify_key: "", verify_sign: expected })).toBe(false);
    expect(p.verifyIpnSignature({ ...form })).toBe(false);
  });
});

describe("SSLCOMMERZ session and validation (fetch stubbed)", () => {
  it("creates a session server-side and only accepts gateway hosts for the redirect", async () => {
    const calls: { url: string; body: URLSearchParams }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as URLSearchParams });
      return new Response(JSON.stringify({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/EasyCheckOut/abc", sessionkey: "SK1" }));
    }) as typeof fetch;
    const p = createSslcommerzProvider({ storeId: "store", storePassword: "pw", sandbox: true, fetchImpl });
    const r = await p.createSession({
      tranId: "FBK-000123-1", orderNumber: "FBK-000123", amountMinor: 257000, currency: "BDT", itemCount: 2,
      customer: { name: "Test", phone: "+8801711111111", email: null, address: { address_line: "H1", area: "Banani", district: "Dhaka", postal_code: null } },
      urls: { success: "https://x/s", fail: "https://x/f", cancel: "https://x/c", ipn: "https://x/i" },
    });
    expect(r).toEqual({ ok: true, redirectUrl: "https://sandbox.sslcommerz.com/EasyCheckOut/abc", sessionKey: "SK1" });
    expect(calls[0]!.url).toBe("https://sandbox.sslcommerz.com/gwprocess/v4/api.php");
    expect(calls[0]!.body.get("total_amount")).toBe("2570.00");
    expect(calls[0]!.body.get("ipn_url")).toBe("https://x/i");

    const evil = createSslcommerzProvider({
      storeId: "s", storePassword: "p", sandbox: true,
      fetchImpl: (async () => new Response(JSON.stringify({ status: "SUCCESS", GatewayPageURL: "https://evil.example/pay" }))) as typeof fetch,
    });
    const bad = await evil.createSession({ tranId: "FBK-000123-2", orderNumber: "FBK-000123", amountMinor: 1000, currency: "BDT", itemCount: 1, customer: { name: "T", phone: "+8801711111111", email: null, address: { address_line: "H", area: "A", district: "Dhaka", postal_code: null } }, urls: { success: "", fail: "", cancel: "", ipn: "" } });
    expect(bad.ok).toBe(false);
  });

  it("maps validation API answers and parses the paid amount", async () => {
    const fetchImpl = (async (url: RequestInfo | URL) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/validator/api/validationserverAPI.php");
      expect(u.searchParams.get("val_id")).toBe("2510261200001VAL");
      return new Response(JSON.stringify({ status: "VALIDATED", tran_id: "FBK-000123-1", amount: "2570.00", currency_type: "BDT", currency_amount: "2570.00", bank_tran_id: "B1", card_type: "VISA-Dutch Bangla", risk_level: "0", val_id: "2510261200001VAL" }));
    }) as typeof fetch;
    const p = createSslcommerzProvider({ storeId: "s", storePassword: "p", sandbox: false, fetchImpl });
    expect(p.isLive).toBe(true);
    const v = await p.validate("2510261200001VAL");
    expect(v.outcome).toBe("valid");
    expect(v.amountMinor).toBe(257000);
    expect(v.currency).toBe("BDT");
    expect(v.tranId).toBe("FBK-000123-1");
    const down = createSslcommerzProvider({ storeId: "s", storePassword: "p", sandbox: true, fetchImpl: (async () => { throw new Error("timeout"); }) as typeof fetch });
    expect((await down.validate("2510261200001VAL")).outcome).toBe("unknown");
  });
});

describe("provider selection", () => {
  it("uses SSLCOMMERZ whenever credentials exist, the mock only outside production, and nothing otherwise", () => {
    expect(selectProvider({ SSLCOMMERZ_STORE_ID: "a", SSLCOMMERZ_STORE_PASSWORD: "b", NODE_ENV: "production" })).toBe("sslcommerz");
    expect(selectProvider({ SSLCOMMERZ_STORE_ID: "a", SSLCOMMERZ_STORE_PASSWORD: "b", NODE_ENV: "development", PAYMENTS_ALLOW_MOCK: "true" })).toBe("sslcommerz");
    expect(selectProvider({ NODE_ENV: "development" })).toBe("mock");
    expect(selectProvider({ NODE_ENV: "test" })).toBe("mock");
    expect(selectProvider({ NODE_ENV: "production" })).toBeNull();
    expect(selectProvider({ NODE_ENV: "production", PAYMENTS_ALLOW_MOCK: "true" })).toBe("mock");
    expect(selectProvider({ SSLCOMMERZ_STORE_ID: "a", NODE_ENV: "production" })).toBeNull();
  });
});

describe("courier webhooks", () => {
  it("verifies HMAC signatures over the raw body", () => {
    const body = JSON.stringify({ tracking_number: "T1", status: "delivered" });
    const sig = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyHmacWebhook("secret", new Headers({ "x-webhook-signature": sig }), body)).toBe(true);
    expect(verifyHmacWebhook("secret", new Headers({ "x-webhook-signature": `sha256=${sig}` }), body)).toBe(true);
    expect(verifyHmacWebhook("secret", new Headers({ "x-webhook-signature": sig }), body + " ")).toBe(false);
    expect(verifyHmacWebhook("other", new Headers({ "x-webhook-signature": sig }), body)).toBe(false);
    expect(verifyHmacWebhook(undefined, new Headers({ "x-webhook-signature": sig }), body)).toBe(false);
    expect(verifyHmacWebhook("secret", new Headers(), body)).toBe(false);
  });
  it("parses single and batched events and maps statuses case-insensitively", () => {
    const map = (s: string) => (s.toLowerCase() === "delivered" ? ("delivered" as const) : null);
    expect(parseGenericWebhook({ id: "e1", tracking_number: "T1", status: "Delivered" }, map)).toEqual([{ eventId: "e1", trackingNumber: "T1", status: "Delivered", mapped: "delivered" }]);
    const batch = parseGenericWebhook({ events: [{ tracking_code: "T2", status: "in_transit", updated_at: "2026-10-26T10:00:00Z" }, { nope: true }] }, map);
    expect(batch).toHaveLength(1);
    expect(batch[0]!.eventId).toBe("T2:in_transit:2026-10-26T10:00:00Z");
    expect(batch[0]!.mapped).toBeNull();
  });
});
