import type { Metadata } from "next";
import Link from "next/link";
import { Camera, Lock, Shirt, Sparkles, Trash2 } from "lucide-react";
import { ProductCard } from "@/components/shop/product-card";
import { StorePage, btnOutline, btnPrimary } from "@/components/shop/store-page";
import { parseFilters } from "@/lib/catalog/filters";
import { searchProducts } from "@/lib/catalog/queries";
import { tryonOffer } from "@/lib/tryon";

export const metadata: Metadata = { title: "AI try-on", description: "See supported pieces on a photo of yourself before you buy." };

const STEPS = [
  { icon: Shirt, title: "Pick a piece", text: "Open a product with the “Try it on with your photo” panel." },
  { icon: Camera, title: "Add your photo", text: "A clear, front-facing photo, standing, in good light works best." },
  { icon: Sparkles, title: "See the preview", text: "In about a minute you get a generated picture of the garment on you." },
];

const PRIVACY = [
  { icon: Lock, text: "Your photo is private to your account. Staff never see it." },
  { icon: Trash2, text: "Photos and results are deleted automatically when they expire, and you can delete them yourself at any time." },
  { icon: Sparkles, text: "The preview is computer-generated: colour, drape and fit can differ from the real piece." },
];

/** Explains AI try-on and lists the pieces that support it. */
export default async function TryonLandingPage() {
  const offer = tryonOffer();
  const { products } = await searchProducts(parseFilters({ sort: "featured" }), 40);
  const supported = offer ? products.filter((p) => p.tryon_enabled).slice(0, 8) : [];

  return (
    <StorePage title="AI try-on" eyebrow="New" intro="See how a piece could look on you before you order. Upload a photo once, then try supported pieces from their product pages.">
      {offer?.isMock ? (
        <p role="note" className="mx-auto -mt-4 mb-10 max-w-xl rounded-[4px] border border-neutral-300 bg-mist px-4 py-2 text-center text-[12px] text-neutral-700">
          Demo mode: try-on here uses a labelled mock and does not call the real AI provider.
        </p>
      ) : null}

      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="rounded-[6px] border border-neutral-200 bg-mist p-6">
            <div className="flex items-center justify-between">
              <Icon aria-hidden className="h-6 w-6" strokeWidth={1.5} />
              <span aria-hidden className="text-[28px] font-light text-neutral-300">0{i + 1}</span>
            </div>
            <h2 className="mt-6 text-[15px] font-semibold">{title}</h2>
            <p className="mt-1 text-[14px] text-neutral-600">{text}</p>
          </li>
        ))}
      </ol>

      <section aria-labelledby="privacy-h" className="mx-auto mt-14 max-w-3xl">
        <h2 id="privacy-h" className="text-center text-[13px] font-semibold uppercase tracking-[0.2em]">Your photo, your control</h2>
        <ul className="mt-6 space-y-3">
          {PRIVACY.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-3 text-[14px] text-neutral-700">
              <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.6} />
              {text}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="supported-h" className="mt-16">
        <h2 id="supported-h" className="text-center text-[13px] font-semibold uppercase tracking-[0.2em]">Pieces you can try on</h2>
        {supported.length ? (
          <ul className="mt-8 grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4 md:gap-x-4" data-testid="tryon-products">
            {supported.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mx-auto mt-6 max-w-md text-center text-[14px] text-neutral-600" data-testid="tryon-none">
            {offer ? "No pieces support try-on yet. They appear here as soon as the store adds a try-on photo to a product." : "Try-on isn't switched on in this store yet."}
          </p>
        )}
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link href="/shop" className={btnPrimary}>Browse the shop</Link>
          <Link href="/account/try-on" className={btnOutline}>My try-on photos</Link>
        </div>
      </section>
    </StorePage>
  );
}
