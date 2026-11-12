import { AnalyticsTags } from "@/components/shop/analytics-tags";
import { ConsentBanner } from "@/components/shop/consent-banner";
import { MarketingBanner } from "@/components/shop/marketing-banner";
import { SiteFooter } from "@/components/shop/site-footer";
import { SiteHeader } from "@/components/shop/site-header";
import { headers } from "next/headers";
import { getMetaPixelIds } from "@/lib/settings/public";

const GA4 = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || null;
const PIXEL = process.env.NEXT_PUBLIC_META_PIXEL_ID || null;

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  // CSP nonce minted in proxy.ts; third-party tags must carry it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const pixels = [...new Set([...(PIXEL ? [PIXEL] : []), ...(await getMetaPixelIds())])].slice(0, 5);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <MarketingBanner />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <ConsentBanner hasTags={Boolean(GA4 || pixels.length)} />
      <AnalyticsTags ga4={GA4} pixels={pixels} nonce={nonce} />
    </>
  );
}
