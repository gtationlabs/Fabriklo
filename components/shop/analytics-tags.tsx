"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { CONSENT_COOKIE, parseConsent, readCookie, type Consent } from "@/lib/consent";
import { ATTRIBUTION_COOKIE_NAME, captureAttribution } from "@/lib/attribution";

/**
 * Third-party tags load only after consent, and only when an id is configured
 * (NEXT_PUBLIC_GA4_MEASUREMENT_ID / NEXT_PUBLIC_META_PIXEL_ID; CSP is extended
 * for them in next.config.ts). Attribution (UTM, landing page) is captured into
 * a first-party cookie with analytics consent and attached to the order.
 */
export function AnalyticsTags({ ga4, pixel }: { ga4: string | null; pixel: string | null }) {
  const [consent, setConsent] = useState<Consent | null>(null);
  useEffect(() => {
    const sync = () => setConsent(parseConsent(readCookie(CONSENT_COOKIE)));
    const t = setTimeout(sync, 0);
    window.addEventListener("fbk:consent", sync);
    return () => {
      clearTimeout(t);
      window.removeEventListener("fbk:consent", sync);
    };
  }, []);
  useEffect(() => {
    if (consent?.analytics) captureAttribution(window.location, document.referrer, readCookie(ATTRIBUTION_COOKIE_NAME));
  }, [consent]);

  return (
    <>
      {consent?.analytics && ga4 ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`} strategy="afterInteractive" />
          <Script id="ga4-init" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(ga4)},{anonymize_ip:true});`}</Script>
        </>
      ) : null}
      {consent?.marketing && pixel ? (
        <Script id="meta-pixel" strategy="afterInteractive">{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(pixel)});fbq('track','PageView');`}</Script>
      ) : null}
    </>
  );
}
