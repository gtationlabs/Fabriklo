import { describe, expect, it } from "vitest";
import { attributionFromLocation } from "@/lib/attribution";
import { parseConsent } from "@/lib/consent";
import { selectEmailProvider, selectSmsProvider, selectWhatsappProvider } from "@/lib/notify/select";
import { placeholdersIn, renderTemplate, templateVars } from "@/lib/notify/templates";
import { checkWebhookTarget, sendWebhook, signWebhook, verifyWebhookSignature } from "@/lib/notify/webhook";

describe("templates", () => {
  it("replaces allow-listed placeholders, leaves unknown ones empty and never interprets payload values", () => {
    const vars = templateVars({ order_number: "FBK-100001", customer_name: "<b>Rahim</b> {{store_name}}", total_minor: 150000, payment_method: "cod" }, { siteUrl: "https://shop.example", storeName: "Fabriklo" });
    const out = renderTemplate("Hi {{customer_name}}, order {{ order_number }} total {{total}} via {{payment_method}} {{unknown}} {{store_name}}", vars);
    expect(out).toBe("Hi <b>Rahim</b> {{store_name}}, order FBK-100001 total ৳1,500 via Cash on delivery  Fabriklo");
    expect(placeholdersIn("{{a}} {{b}} {{a}} {{not-valid}}")).toEqual(["a", "b"]);
    expect(renderTemplate("x{{evil}}y", { evil: "line\r\nInjected-Header: 1\u0000" })).toBe("xline\r\nInjected-Header: 1y");
  });
});

describe("provider selection", () => {
  it("uses real providers only when configured, the mock only outside production or when explicitly allowed", () => {
    expect(selectEmailProvider({ NODE_ENV: "production" })).toBeNull();
    expect(selectEmailProvider({ NODE_ENV: "production", NOTIFY_ALLOW_MOCK: "true" })).toBe("mock");
    expect(selectEmailProvider({ NODE_ENV: "development" })).toBe("mock");
    expect(selectEmailProvider({ NODE_ENV: "production", SMTP_URL: "smtp://u:p@h:587" })).toBe("smtp");
    expect(selectSmsProvider({ NODE_ENV: "production", SMS_GATEWAY_URL: "https://g" })).toBeNull(); // key missing
    expect(selectSmsProvider({ NODE_ENV: "production", SMS_GATEWAY_URL: "https://g", SMS_API_KEY: "k" })).toBe("http_gateway");
    expect(selectWhatsappProvider({ NODE_ENV: "test" })).toBe("mock");
    expect(selectWhatsappProvider({ NODE_ENV: "production", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" })).toBe("meta_cloud");
  });
});

describe("outbound webhooks", () => {
  const allow = ["hooks.example.com"];
  it("refuses anything but https to an allowlisted host; never IPs or internal names", () => {
    expect(checkWebhookTarget("https://hooks.example.com/in", allow).ok).toBe(true);
    expect(checkWebhookTarget("https://HOOKS.example.com/in", allow).ok).toBe(true);
    expect(checkWebhookTarget("http://hooks.example.com/in", allow)).toMatchObject({ ok: false, reason: "not_https" });
    expect(checkWebhookTarget("https://other.example.com/in", allow)).toMatchObject({ ok: false, reason: "not_allowlisted" });
    expect(checkWebhookTarget("https://hooks.example.com.evil.net/in", allow)).toMatchObject({ ok: false, reason: "not_allowlisted" });
    expect(checkWebhookTarget("https://10.0.0.1/in", ["10.0.0.1"])).toMatchObject({ ok: false, reason: "ip_literal" });
    expect(checkWebhookTarget("https://[::1]/in", ["::1"])).toMatchObject({ ok: false, reason: "ip_literal" });
    expect(checkWebhookTarget("https://localhost/in", ["localhost"])).toMatchObject({ ok: false, reason: "internal_host" });
    expect(checkWebhookTarget("https://db.internal/in", ["db.internal"])).toMatchObject({ ok: false, reason: "internal_host" });
    expect(checkWebhookTarget("https://user:pw@hooks.example.com/in", allow)).toMatchObject({ ok: false, reason: "invalid" });
    expect(checkWebhookTarget("not a url", allow)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("signs with HMAC-SHA256 over timestamp.body and verifies within a freshness window", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signWebhook("secret", ts, '{"a":1}');
    expect(verifyWebhookSignature("secret", ts, '{"a":1}', sig)).toBe(true);
    expect(verifyWebhookSignature("secret", ts, '{"a":2}', sig)).toBe(false);
    expect(verifyWebhookSignature("other", ts, '{"a":1}', sig)).toBe(false);
    expect(verifyWebhookSignature("secret", String(Number(ts) - 600), '{"a":1}', signWebhook("secret", String(Number(ts) - 600), '{"a":1}'))).toBe(false);
  });

  it("posts JSON with signature headers, does not follow redirects, and classifies failures", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const mk = (status: number) => (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init! });
      return new Response("ok", { status });
    }) as typeof fetch;
    const url = new URL("https://hooks.example.com/in");
    const ok = await sendWebhook(url, { order_number: "FBK-1" }, { secret: "s", eventName: "order.placed", deliveryId: "d1", fetchImpl: mk(200) });
    expect(ok).toMatchObject({ ok: true, status: 200 });
    const h = new Headers(seen[0]!.init.headers);
    expect(h.get("x-fabriklo-signature")).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(h.get("x-fabriklo-event")).toBe("order.placed");
    expect(seen[0]!.init.redirect).toBe("manual");
    const body = JSON.parse(String(seen[0]!.init.body)) as { event: string; data: { order_number: string } };
    expect(body.data.order_number).toBe("FBK-1");
    expect(verifyWebhookSignature("s", h.get("x-fabriklo-timestamp")!, String(seen[0]!.init.body), h.get("x-fabriklo-signature")!.slice(3))).toBe(true);
    expect(await sendWebhook(url, {}, { secret: null, eventName: "e", deliveryId: "d", fetchImpl: mk(503) })).toMatchObject({ ok: false, retryable: true });
    expect(await sendWebhook(url, {}, { secret: null, eventName: "e", deliveryId: "d", fetchImpl: mk(404) })).toMatchObject({ ok: false, retryable: false });
    expect(await sendWebhook(url, {}, { secret: null, eventName: "e", deliveryId: "d", fetchImpl: mk(302) })).toMatchObject({ ok: false, retryable: false, status: 302 });
    const down = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
    expect(await sendWebhook(url, {}, { secret: null, eventName: "e", deliveryId: "d", fetchImpl: down })).toMatchObject({ ok: false, retryable: true, status: null });
  });
});

describe("consent and attribution", () => {
  it("parses the consent cookie strictly", () => {
    expect(parseConsent(encodeURIComponent(JSON.stringify({ v: 1, analytics: true, marketing: false })))).toEqual({ v: 1, analytics: true, marketing: false });
    expect(parseConsent(encodeURIComponent(JSON.stringify({ v: 2, analytics: true })))).toBeNull();
    expect(parseConsent("garbage")).toBeNull();
    expect(parseConsent(encodeURIComponent(JSON.stringify({ v: 1, analytics: "yes" })))).toEqual({ v: 1, analytics: false, marketing: false });
  });
  it("captures UTM and landing data only when there is something to attribute, with bounded lengths", () => {
    expect(attributionFromLocation({ search: "", pathname: "/" }, "")).toBeNull();
    const a = attributionFromLocation({ search: "?utm_source=newsletter&utm_campaign=" + "x".repeat(400), pathname: "/shop" }, "https://www.facebook.com/x");
    expect(a).toMatchObject({ utm_source: "newsletter", landing_path: "/shop", referrer_host: "www.facebook.com" });
    expect(a!.utm_campaign).toHaveLength(150);
    expect(attributionFromLocation({ search: "", pathname: "/p" }, "https://google.com/")).toMatchObject({ referrer_host: "google.com" });
  });
});
