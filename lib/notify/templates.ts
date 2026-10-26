/**
 * Plain-text templates with {{placeholders}}. There is deliberately no HTML
 * and no expression language: a placeholder is replaced by the string value of
 * an allow-listed variable, or by an empty string. Nothing from the payload is
 * ever interpreted.
 */
export type TemplateVars = Record<string, string | number | boolean | null | undefined>;

const PLACEHOLDER = /\{\{\s*([a-z0-9_]{1,60})\s*\}\}/g;

export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(PLACEHOLDER, (_m, key: string) => {
    const v = vars[key];
    if (v === null || v === undefined) return "";
    // Strip control characters so a payload value cannot inject headers or line noise.
    return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 2000);
  });
}

export function placeholdersIn(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(PLACEHOLDER), (m) => m[1]!)));
}

/** Variables every template may use, derived from the outbox payload (never raw objects). */
export function templateVars(payload: Record<string, unknown>, opts: { siteUrl: string; storeName: string; confirmUrl?: string; unsubscribeUrl?: string }): TemplateVars {
  const str = (k: string) => (typeof payload[k] === "string" || typeof payload[k] === "number" || typeof payload[k] === "boolean" ? String(payload[k]) : "");
  const minor = Number(payload.total_minor ?? NaN);
  return {
    store_name: opts.storeName,
    site_url: opts.siteUrl,
    order_number: str("order_number"),
    customer_name: str("customer_name"),
    total: Number.isFinite(minor) ? `৳${(minor / 100).toLocaleString("en-BD", { maximumFractionDigits: 0 })}` : "",
    payment_method: str("payment_method") === "cod" ? "Cash on delivery" : str("payment_method") === "sslcommerz" ? "Online payment" : str("payment_method"),
    payment_status: str("payment_status"),
    district: str("district"),
    item_count: str("item_count"),
    coupon_code: str("coupon_code"),
    sku: str("sku"),
    product_title: str("product_title"),
    available: str("available"),
    event_type: str("event_type"),
    title: str("title"),
    note: str("note"),
    severity: str("severity"),
    rule_name: str("rule_name"),
    campaign_name: str("campaign_name"),
    week: str("week"),
    orders: str("orders"),
    confirm_url: opts.confirmUrl ?? "",
    unsubscribe_url: opts.unsubscribeUrl ?? "",
    track_url: str("order_number") ? `${opts.siteUrl}/orders/track` : "",
  };
}
