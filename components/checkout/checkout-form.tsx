"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Cart } from "@/lib/cart/types";
import type { Quote } from "@/lib/checkout/schema";
import { normalizeBdPhone } from "@/lib/geo/bd";
import { formatBDT } from "@/lib/money";

type FieldErrors = Partial<Record<string, string>>;
const KEY_STORAGE = "fbk_checkout_key";

/** One idempotency key per checkout attempt, kept across reloads/double clicks. */
function idempotencyKey(): string {
  try {
    const existing = sessionStorage.getItem(KEY_STORAGE);
    if (existing && /^[A-Za-z0-9_-]{16,120}$/.test(existing)) return existing;
    const fresh = crypto.randomUUID().replace(/-/g, "");
    sessionStorage.setItem(KEY_STORAGE, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID().replace(/-/g, "");
  }
}

function clearKey() {
  try {
    sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
}

const inputCls =
  "mt-1 w-full rounded border border-line bg-white px-3 py-2.5 text-espresso focus:border-bronze focus:outline-none focus:ring-2 focus:ring-bronze/30 aria-[invalid=true]:border-danger";

export type CheckoutPrefill = { name: string; phone: string; email: string; district: string; area: string; addressLine: string; postalCode: string };

export function CheckoutForm({ cart, divisions, prefill }: { cart: Cart; divisions: Record<string, readonly string[]>; prefill?: CheckoutPrefill }) {
  const router = useRouter();
  const formId = useId();
  const [district, setDistrict] = useState(prefill?.district ?? "");
  const [quote, setQuote] = useState<Quote | null>(null);

  const [quoting, setQuoting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const seq = useRef(0);
  const loadQuote = useCallback(async (d: string) => {
    const mine = ++seq.current;
    setQuoting(true);
    try {
      const res = await fetch("/api/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ district: d || null }),
      });
      if (res.status === 404) {
        router.replace("/cart");
        return null;
      }
      const body = (await res.json().catch(() => null)) as Quote | null;
      if (mine !== seq.current) return null; // a newer district choice wins
      if (res.ok && body) setQuote(body);
      return body;
    } finally {
      if (mine === seq.current) setQuoting(false);
    }
  }, [router]);

  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  // A prefilled district needs its delivery quote once the form is on screen.
  const prefillDistrict = prefill?.district ?? "";
  useEffect(() => {
    if (!prefillDistrict) return;
    const t = setTimeout(() => void loadQuote(prefillDistrict), 0);
    return () => clearTimeout(t);
  }, [prefillDistrict, loadQuote]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const next: FieldErrors = {};
    if (get("name").length < 2) next.name = "Enter your full name";
    if (!normalizeBdPhone(get("phone"))) next.phone = "Enter a Bangladesh mobile number, e.g. 01712 345678";
    if (!district) next.district = "Choose your district";
    if (get("area").length < 2) next.area = "Enter your area or thana";
    if (get("addressLine").length < 5) next.addressLine = "Enter house, road and any landmark";
    if (get("postalCode") && !/^\d{4}$/.test(get("postalCode"))) next.postalCode = "Postcodes have 4 digits";
    setErrors(next);
    if (Object.keys(next).length) {
      setFormError("Please fix the highlighted fields.");
      return;
    }
    if (!quote || quote.total_minor == null) {
      setFormError("Choose a district we deliver to.");
      return;
    }
    if (quote.issues.length) {
      setFormError("Some items in your cart are no longer available. Please update your cart.");
      return;
    }
    if (!quote.cod_available) {
      setFormError("Cash on delivery isn't available for this order.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/checkout/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey(),
          name: get("name"),
          phone: get("phone"),
          email: get("email") || undefined,
          district,
          area: get("area"),
          addressLine: get("addressLine"),
          postalCode: get("postalCode") || undefined,
          note: get("note") || undefined,
          paymentMethod: "cod",
          expectedTotalMinor: quote.total_minor,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        clearKey();
        router.replace("/order/success");
        router.refresh();
        return;
      }
      const code = body?.error?.code as string | undefined;
      if (code === "quote_changed" || code === "stock_unavailable") {
        clearKey(); // the next attempt is a new order request
        await loadQuote(district);
      }
      if (code === "invalid_input" && Array.isArray(body?.error?.fields)) {
        const fe: FieldErrors = {};
        for (const f of body.error.fields as { path: string; message: string }[]) fe[f.path] = f.message;
        setErrors(fe);
      }
      setFormError(body?.error?.message ?? "We couldn't place your order. Please try again.");
    } catch {
      setFormError("Network problem. Your order may not have been placed: press the button again, it won't create a duplicate.");
    } finally {
      setSubmitting(false);
    }
  }

  const field = (name: string) => ({
    id: `${formId}-${name}`,
    name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${formId}-${name}-err` : undefined,
  });
  const err = (name: string) =>
    errors[name] ? (
      <p id={`${formId}-${name}-err`} className="mt-1 text-sm text-danger">
        {errors[name]}
      </p>
    ) : null;

  const lines = quote?.lines ?? cart.items.map((i) => ({ ...i, title: i.title }));

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
      <div className="space-y-8">
        {formError ? (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
          >
            {formError}
          </div>
        ) : null}

        <fieldset className="space-y-4">
          <legend className="font-semibold text-espresso">Contact</legend>
          <div>
            <label htmlFor={`${formId}-name`} className="text-sm font-medium">Full name</label>
            <input {...field("name")} defaultValue={prefill?.name ?? ""} autoComplete="name" required className={inputCls} />
            {err("name")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${formId}-phone`} className="text-sm font-medium">Mobile number</label>
              <input {...field("phone")} defaultValue={prefill?.phone ?? ""} type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" required className={inputCls} />
              {err("phone")}
            </div>
            <div>
              <label htmlFor={`${formId}-email`} className="text-sm font-medium">
                Email <span className="font-normal text-muted">(optional)</span>
              </label>
              <input {...field("email")} defaultValue={prefill?.email ?? ""} type="email" autoComplete="email" className={inputCls} />
              {err("email")}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-semibold text-espresso">Delivery address</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${formId}-district`} className="text-sm font-medium">District</label>
              <select
                {...field("district")}
                value={district}
                onChange={(e) => {
                  setDistrict(e.target.value);
                  void loadQuote(e.target.value);
                }}
                required
                className={inputCls}
              >
                <option value="">Choose district</option>
                {Object.entries(divisions).map(([division, districts]) => (
                  <optgroup key={division} label={`${division} division`}>
                    {districts.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {err("district")}
            </div>
            <div>
              <label htmlFor={`${formId}-area`} className="text-sm font-medium">Area / thana</label>
              <input {...field("area")} defaultValue={prefill?.area ?? ""} autoComplete="address-level3" required className={inputCls} />
              {err("area")}
            </div>
          </div>
          <div>
            <label htmlFor={`${formId}-addressLine`} className="text-sm font-medium">House, road, landmark</label>
            <textarea {...field("addressLine")} defaultValue={prefill?.addressLine ?? ""} autoComplete="street-address" rows={2} required className={inputCls} />
            {err("addressLine")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${formId}-postalCode`} className="text-sm font-medium">
                Postcode <span className="font-normal text-muted">(optional)</span>
              </label>
              <input {...field("postalCode")} defaultValue={prefill?.postalCode ?? ""} inputMode="numeric" autoComplete="postal-code" maxLength={4} className={inputCls} />
              {err("postalCode")}
            </div>
          </div>
          <div>
            <label htmlFor={`${formId}-note`} className="text-sm font-medium">
              Delivery note <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea {...field("note")} rows={2} maxLength={500} className={inputCls} />
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-semibold text-espresso">Payment</legend>
          <label className="mt-3 flex items-start gap-3 rounded border border-bronze bg-cream p-4">
            <input type="radio" name="paymentMethod" value="cod" defaultChecked className="mt-1 accent-bronze" />
            <span>
              <span className="font-medium text-espresso">Cash on delivery</span>
              <span className="block text-sm text-muted">Pay the rider in cash when your parcel arrives.</span>
            </span>
          </label>
          <p className="mt-2 text-xs text-muted">Online card and mobile banking payment will be added with SSLCOMMERZ.</p>
        </fieldset>
      </div>

      <aside className="h-fit rounded border border-line bg-cream p-6" aria-live="polite" aria-busy={quoting}>
        <h2 className="font-semibold text-espresso">Order summary</h2>
        <ul className="mt-4 space-y-3 text-sm">
          {lines.map((l) => (
            <li key={l.variant_id} className="flex justify-between gap-3">
              <span>
                {l.title} <span className="text-muted">· {l.size} / {l.color} × {l.quantity}</span>
              </span>
              <span className="shrink-0">{formatBDT(l.line_total_minor)}</span>
            </li>
          ))}
        </ul>
        {quote?.issues.length ? (
          <p className="mt-3 text-sm text-danger">
            {quote.issues.map((i) => i.title).join(", ")}: no longer available in that quantity.{" "}
            <Link href="/cart" className="underline">Update cart</Link>
          </p>
        ) : null}
        <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatBDT(quote?.subtotal_minor ?? cart.subtotal_minor)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Delivery{quote?.zone ? <span className="text-muted"> · {quote.zone.name}</span> : null}</dt>
            <dd data-testid="checkout-shipping">
              {!district ? "Choose district" : quote?.shipping_minor == null ? "…" : quote.shipping_minor === 0 ? "Free" : formatBDT(quote.shipping_minor)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-espresso">
            <dt>Total</dt>
            <dd data-testid="checkout-total">{formatBDT(quote?.total_minor ?? quote?.subtotal_minor ?? cart.subtotal_minor)}</dd>
          </div>
        </dl>
        {quote?.zone ? (
          <p className="mt-2 text-xs text-muted">
            Usually delivered in {quote.zone.min_days}–{quote.zone.max_days} days.
          </p>
        ) : null}
        {district && quote && !quote.cod_available && quote.total_minor != null ? (
          <p className="mt-2 text-sm text-danger">Cash on delivery isn&apos;t available for this order total.</p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || quoting}
          className="mt-6 w-full rounded bg-espresso px-5 py-3 font-medium text-cream hover:bg-charcoal disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? "Placing order…" : "Place order (cash on delivery)"}
        </button>
        <p className="mt-2 text-xs text-muted">Prices and stock are confirmed on our server when you place the order.</p>
      </aside>
    </form>
  );
}
