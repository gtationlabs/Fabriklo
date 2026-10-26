import { AnalyticsTags } from "@/components/shop/analytics-tags";
import { ConsentBanner } from "@/components/shop/consent-banner";
import { MarketingBanner } from "@/components/shop/marketing-banner";
import { SiteFooter } from "@/components/shop/site-footer";
import { SiteHeader } from "@/components/shop/site-header";

const GA4 = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || null;
const PIXEL = process.env.NEXT_PUBLIC_META_PIXEL_ID || null;

export default function ShopLayout({ children }: { children: React.ReactNode }) {
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
      <ConsentBanner hasTags={Boolean(GA4 || PIXEL)} />
      <AnalyticsTags ga4={GA4} pixel={PIXEL} />
    </>
  );
}
