import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBadge } from "@/components/ui/demo-badge";
import { demoArtPath } from "@/lib/catalog/demo-catalog";
import { ProductCard } from "@/components/shop/product-card";
import { CarouselItem, ProductCarousel } from "@/components/shop/product-carousel";
import { ProductView, type ViewPhoto } from "@/components/shop/product-view";
import { RecentlyViewed } from "@/components/shop/recently-viewed";
import { ProductReviewsSection } from "@/components/shop/product-reviews";
import { getProductReviews } from "@/lib/reviews/queries";
import { WishlistButton } from "@/components/shop/wishlist";
import { garmentKind } from "@/components/shop/garment-art";
import { TryonPanel } from "@/components/tryon/tryon-panel";
import { getCustomer } from "@/lib/account/session";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { tryonOffer } from "@/lib/tryon";
import { parseFilters } from "@/lib/catalog/filters";
import { getProductBySlug, searchProducts, type ProductCard as ProductCardData, type ProductDetail } from "@/lib/catalog/queries";
import { detailToCard, productBreadcrumb, shareLinks } from "@/lib/catalog/product-page";
import { publicEnv } from "@/lib/env";
import { getStoreContact, getStoreIdentity } from "@/lib/settings/public";

export async function generateMetadata({ params }: PageProps<"/product/[slug]">): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  if (!product) return { title: "Product not found" };
  return {
    title: product.seo_title ?? product.title,
    description: product.seo_description ?? product.subtitle,
    alternates: { canonical: `/product/${product.slug}` },
    // Demo catalogue must not be indexed.
    robots: product.is_demo ? { index: false } : undefined,
    openGraph: { title: product.title, description: product.subtitle, type: "website" },
  };
}

export default async function ProductPage({ params }: PageProps<"/product/[slug]">) {
  const product = await getProductBySlug((await params).slug);
  if (!product || product.variants.length === 0) notFound();

  const garment = product.media.find((m) => m.is_tryon_garment);
  const offer = product.tryon_enabled && garment ? tryonOffer() : null;
  const [tryonConfig, customer] = offer
    ? await Promise.all([
        createSupabasePublicClient().rpc("tryon_public_config").then((r) => (r.data ?? null) as { enabled: boolean; retention_hours: number; consent_version: string } | null),
        getCustomer(),
      ])
    : [null, null];
  const tryon = offer && tryonConfig?.enabled ? { offer, config: tryonConfig } : null;

  const photos: ViewPhoto[] = product.media
    .filter((m) => !m.is_tryon_garment)
    .map((m) => ({ id: m.id, src: m.storage_path, alt: m.alt, color: m.variant_id ? (product.variants.find((v) => v.id === m.variant_id)?.color ?? null) : null }));
  const demoArt = photos.length === 0 && product.is_demo ? demoArtPath(product.slug) : null;
  const artKind = photos.length === 0 && product.category?.slug !== "accessories" ? garmentKind(product.category?.slug ?? null, product.title) : null;

  const [identity, contact, related, reviews, reviewer] = await Promise.all([
    getStoreIdentity(), getStoreContact(), relatedProducts(product), getProductReviews(product.id), customer ? Promise.resolve(customer) : getCustomer(),
  ]);
  const crumbs = productBreadcrumb(product);
  const url = `${publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/product/${product.slug}`;

  return (
    <div className="bg-[#f5f5f7] font-catalog">
      <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="mb-8 text-[14px]">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {crumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                {i > 0 ? <span aria-hidden className="text-neutral-400">/</span> : null}
                {c.href ? (
                  <Link href={c.href} className="text-ink underline underline-offset-2 hover:no-underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-neutral-600">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <ProductView
          title={product.title}
          code={product.style_code}
          brand={identity.name}
          variants={product.variants}
          photos={photos}
          demoArt={demoArt}
          artKind={artKind}
          shares={shareLinks(url, product.title)}
          titleAction={<WishlistButton product={detailToCard(product)} size="lg" className="border border-neutral-200 shadow-none" />}
          store={{ name: identity.name, address: contact?.address ?? "", hours: contact?.hours ?? "", phone: contact?.phone ?? null }}
        >
          {product.is_demo ? <DemoBadge className="mt-6" /> : null}
          {tryon ? (
            <div className="mt-8">
              <TryonPanel
                productTitle={product.title}
                variants={product.variants.map((v) => ({ id: v.id, size: v.size, color: v.color, available: v.available }))}
                signedIn={!!customer}
                signInHref={`/account/login?next=${encodeURIComponent(`/product/${product.slug}`)}`}
                offer={tryon.offer}
                consentVersion={tryon.config.consent_version}
                retentionHours={tryon.config.retention_hours}
              />
            </div>
          ) : null}
          <div className="mt-8 divide-y divide-neutral-300 border-y border-neutral-300 text-[14px]">
            {product.subtitle || product.description ? (
              <details className="py-4">
                <summary className="cursor-pointer font-medium text-ink">Details</summary>
                {product.subtitle ? <p className="mt-3 text-neutral-700">{product.subtitle}</p> : null}
                <p className="mt-2 whitespace-pre-line text-neutral-700">{product.description}</p>
              </details>
            ) : null}
            <details className="py-4">
              <summary className="cursor-pointer font-medium text-ink">Materials & care</summary>
              <p className="mt-3 whitespace-pre-line text-neutral-700">{product.materials}</p>
              <p className="mt-2 whitespace-pre-line text-neutral-700">{product.care}</p>
            </details>
            <details className="py-4">
              <summary className="cursor-pointer font-medium text-ink">Delivery & returns</summary>
              <p className="mt-3 text-neutral-700">
                Delivery fees and estimates are calculated at checkout from your district. See{" "}
                <Link href="/shipping" className="underline">shipping</Link> and <Link href="/returns" className="underline">returns</Link>.
              </p>
            </details>
          </div>
        </ProductView>

        <ProductReviewsSection
          productId={product.id}
          slug={product.slug}
          data={reviews}
          signedIn={!!reviewer}
          defaultName={reviewer?.fullName ? `${reviewer.fullName.split(" ")[0]} ${(reviewer.fullName.split(" ")[1] ?? "").slice(0, 1)}`.trim() : ""}
          sizes={[...new Set(product.variants.map((v) => v.size))]}
        />

        {related.length ? (
          <div className="mt-24">
            <ProductCarousel id="also-like" title="You May Also Like">
              {related.map((p) => (
                <CarouselItem key={p.id}>
                  <ProductCard product={p} />
                </CarouselItem>
              ))}
            </ProductCarousel>
          </div>
        ) : null}
        <div className="mt-20 empty:hidden">
          <RecentlyViewed current={detailToCard(product)} />
        </div>
      </div>
    </div>
  );
}

/** Same category first, topped up from the same department, current product left out. */
async function relatedProducts(product: ProductDetail): Promise<ProductCardData[]> {
  const take = 10;
  const seen = new Set([product.id]);
  const out: ProductCardData[] = [];
  const add = (list: ProductCardData[]) => {
    for (const p of list) {
      if (seen.has(p.id) || out.length >= take) continue;
      seen.add(p.id);
      out.push(p);
    }
  };
  try {
    if (product.category) add((await searchProducts(parseFilters({}, { category: product.category.slug }), take + 1)).products);
    if (out.length < take && (product.audience === "men" || product.audience === "women"))
      add((await searchProducts(parseFilters({}, { audience: product.audience }), take + 1)).products);
  } catch {
    // The page still works without recommendations.
  }
  return out;
}
