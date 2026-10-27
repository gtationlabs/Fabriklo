"use client";

import { useEffect, useRef, useState } from "react";
import { CONSENT_COOKIE, parseConsent, readCookie, type Consent } from "@/lib/consent";

function writeConsent(c: Consent) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(c))}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent("fbk:consent", { detail: c }));
}

export function ConsentBanner({ hasTags }: { hasTags: boolean }) {
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // Publish the banner height so fixed/absolute UI underneath it (the store tour dots) can move out of the way.
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!open || !el) {
      root.style.removeProperty("--fbk-bottom-ui");
      return;
    }
    const apply = () => root.style.setProperty("--fbk-bottom-ui", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--fbk-bottom-ui");
    };
  }, [open, choosing]);

  useEffect(() => {
    // Read the cookie after hydration so server and client markup match.
    const t = setTimeout(() => setOpen(parseConsent(readCookie(CONSENT_COOKIE)) === null), 0);
    return () => clearTimeout(t);
  }, []);

  if (!open) return null;
  const save = (c: Omit<Consent, "v">) => {
    writeConsent({ v: 1, ...c });
    setOpen(false);
  };
  return (
    <section ref={ref} role="dialog" aria-labelledby="consent-h" aria-live="polite" data-testid="consent-banner" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper p-4 shadow-lg sm:p-5">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <h2 id="consent-h" className="font-semibold text-espresso">Cookies</h2>
          <p className="text-muted">
            Essential cookies keep your cart and sign-in working. {hasTags ? "With your permission we also measure visits (analytics) and show relevant offers (marketing)." : "Analytics and marketing cookies are not switched on for this store yet, but you can set your preference now."}
          </p>
          {choosing ? (
            <div className="mt-2 flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> Analytics</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> Marketing</label>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {choosing ? (
            <button type="button" onClick={() => save({ analytics, marketing })} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream">Save choices</button>
          ) : (
            <>
              <button type="button" onClick={() => save({ analytics: false, marketing: false })} className="rounded border border-espresso px-4 py-2 text-sm font-medium">Essential only</button>
              <button type="button" onClick={() => setChoosing(true)} className="rounded border border-line px-4 py-2 text-sm">Choose</button>
              <button type="button" onClick={() => save({ analytics: true, marketing: true })} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream">Accept all</button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
