import Link from "next/link";
import { ProductCard } from "@/components/shop/product-card";
import { parseFilters } from "@/lib/catalog/filters";
import { getFacets, searchProducts } from "@/lib/catalog/queries";
import { getPublishedHeroScenes, heroSrcSet } from "@/lib/cms/hero";

export default async function HomePage() {
  const [scenes, featured, newest, facets] = await Promise.all([
    getPublishedHeroScenes(),
    searchProducts(parseFilters({ sort: "featured" }), 8),
    searchProducts(parseFilters({}), 4),
    getFacets(),
  ]);
  const first = scenes[0]!;

  return (
    <>
      {/* Static first scene. The scroll-driven 5-scene tour mounts here in the hero milestone;
          this markup doubles as its reduced-motion / no-JS fallback. */}
      <section aria-labelledby="hero-heading" className="relative isolate flex min-h-[85svh] items-end overflow-hidden bg-espresso">
        {/* eslint-disable-next-line @next/next/no-img-element -- responsive srcset of pre-optimised renders */}
        <img
          src={first.image_path}
          srcSet={heroSrcSet(first.image_path)}
          sizes="100vw"
          alt={first.image_alt}
          fetchPriority="high"
          className="absolute inset-0 -z-10 h-full w-full object-cover"
          style={{ objectPosition: first.object_position }}
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-espresso/85 via-espresso/30 to-transparent" aria-hidden />
        <div className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
          <p className="text-sm uppercase tracking-[0.25em] text-cream/80">{first.eyebrow}</p>
          <h1 id="hero-heading" className="mt-3 max-w-2xl font-display text-5xl font-semibold leading-tight text-cream md:text-7xl">
            {first.heading}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-cream/85">{first.body}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={first.cta_href ?? "/shop"} className="rounded bg-cream px-6 py-3 font-medium text-espresso hover:bg-white">
              {first.cta_label ?? "Explore the collection"}
            </Link>
            <Link href="#featured" className="rounded border border-cream/60 px-6 py-3 font-medium text-cream hover:bg-cream/10">
              Skip store tour
            </Link>
          </div>
        </div>
      </section>

      <section id="featured" aria-labelledby="featured-heading" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="flex items-end justify-between">
          <h2 id="featured-heading" className="font-display text-3xl font-semibold text-espresso">Featured</h2>
          <Link href="/shop?sort=featured" className="text-sm text-bronze-strong underline">View all</Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
          {featured.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section aria-labelledby="audience-heading" className="mx-auto grid max-w-7xl gap-4 px-4 sm:px-6 md:grid-cols-2">
        <h2 id="audience-heading" className="sr-only">Shop by department</h2>
        {[
          { href: "/men", label: "Men", img: "/assets/store/store-03-1280.webp", alt: "Trousers and shirts on store racks" },
          { href: "/women", label: "Women", img: "/assets/store/store-02-1280.webp", alt: "Tops and tees on store shelving" },
        ].map((d) => (
          <Link key={d.href} href={d.href} className="group relative block aspect-[16/9] overflow-hidden rounded">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.img} alt={d.alt} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
            <span className="absolute inset-0 bg-espresso/35" aria-hidden />
            <span className="absolute bottom-6 left-6 font-display text-4xl font-semibold text-cream">{d.label}</span>
          </Link>
        ))}
      </section>

      <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 id="categories-heading" className="font-display text-3xl font-semibold text-espresso">Shop by category</h2>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {facets.categories.map((c) => (
            <li key={c.slug}>
              <Link href={`/category/${c.slug}`} className="flex h-24 items-center justify-center rounded border border-line bg-cream text-center font-medium text-espresso hover:border-bronze">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="new-heading" className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex items-end justify-between">
          <h2 id="new-heading" className="font-display text-3xl font-semibold text-espresso">New arrivals</h2>
          <Link href="/collections/new-arrivals" className="text-sm text-bronze-strong underline">View all</Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
          {newest.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section aria-labelledby="tryon-heading" className="mx-auto mt-16 max-w-7xl px-4 sm:px-6">
        <div className="grid items-center gap-8 overflow-hidden rounded bg-espresso text-cream md:grid-cols-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/store/store-05-1280.webp" alt="Fitting rooms in the store" loading="lazy" className="h-full w-full object-cover" />
          <div className="p-8">
            <p className="text-xs uppercase tracking-[0.25em] text-cream/70">Coming soon</p>
            <h2 id="tryon-heading" className="mt-2 font-display text-3xl font-semibold">Try it on with your own photo</h2>
            <p className="mt-3 text-cream/80">
              Preview selected pieces on a photo you upload. It is a visual guide only, not a fit guarantee, and your photo stays private.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
