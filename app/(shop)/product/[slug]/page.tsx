import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBadge } from "@/components/ui/demo-badge";
import { ProductArt } from "@/components/shop/product-art";
import { ProductCard } from "@/components/shop/product-card";
import { PurchasePanel } from "@/components/shop/purchase-panel";
import { parseFilters } from "@/lib/catalog/filters";
import { getProductBySlug, searchProducts } from "@/lib/catalog/queries";

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

  const related = product.category
    ? (await searchProducts(parseFilters({}, { category: product.category.slug }), 5)).products.filter((p) => p.id !== product.id).slice(0, 4)
    : [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/shop" className="hover:underline">Shop</Link> /
          </li>
          {product.category ? (
            <li>
              <Link href={`/category/${product.category.slug}`} className="hover:underline">
                {product.category.name}
              </Link>{" "}
              /
            </li>
          ) : null}
          <li aria-current="page" className="text-espresso">{product.title}</li>
        </ol>
      </nav>
      <div className="grid gap-10 md:grid-cols-2">
        <div className="grid gap-3">
          <ProductArt title={product.title} hex={product.variants[0]?.color_hex} size="hero" />
        </div>
        <div>
          {product.is_demo ? <DemoBadge className="mb-3" /> : null}
          <h1 className="font-display text-4xl font-semibold text-espresso">{product.title}</h1>
          <p className="mt-2 text-muted">{product.subtitle}</p>
          <div className="mt-6">
            <PurchasePanel variants={product.variants} />
          </div>
          <div className="mt-10 divide-y divide-line border-y border-line text-sm">
            <details open className="py-4">
              <summary className="cursor-pointer font-semibold text-espresso">Details</summary>
              <p className="mt-3 whitespace-pre-line text-charcoal">{product.description}</p>
            </details>
            <details className="py-4">
              <summary className="cursor-pointer font-semibold text-espresso">Materials & care</summary>
              <p className="mt-3 whitespace-pre-line">{product.materials}</p>
              <p className="mt-2 whitespace-pre-line">{product.care}</p>
            </details>
            <details className="py-4">
              <summary className="cursor-pointer font-semibold text-espresso">Delivery & returns</summary>
              <p className="mt-3">
                Delivery fees and estimates are calculated at checkout from your district. See{" "}
                <Link href="/shipping" className="underline">shipping</Link> and <Link href="/returns" className="underline">returns</Link>.
              </p>
            </details>
          </div>
        </div>
      </div>
      {related.length ? (
        <section className="mt-20" aria-labelledby="related-heading">
          <h2 id="related-heading" className="font-display text-2xl text-espresso">You may also like</h2>
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
