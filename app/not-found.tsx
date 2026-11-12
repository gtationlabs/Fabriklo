import type { Metadata } from "next";
import { NotFoundView } from "@/components/shop/not-found-view";
import { SiteFooter } from "@/components/shop/site-footer";
import { SiteHeader } from "@/components/shop/site-header";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

/** Unmatched URLs outside any route group still get the store header and footer. */
export default function RootNotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <NotFoundView />
      </main>
      <SiteFooter />
    </>
  );
}
