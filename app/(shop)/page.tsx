import Link from "next/link";
import { ProductCard } from "@/components/shop/product-card";
import { parseFilters } from "@/lib/catalog/filters";
import { getFacets, searchProducts } from "@/lib/catalog/queries";
import { StoreTour } from "@/components/hero/store-tour";
import { getPublishedHero } from "@/lib/cms/hero";
import { GarmentRail } from "@/components/shop/garment-rail";
import { railGarments } from "@/lib/catalog/rail";
import { getStoreIdentity } from "@/lib/settings/public";
import { CategoryShowcase } from "@/components/shop/category-showcase";
import { SHOWCASE_PER_CATEGORY, buildShowcase, type ShowcaseGroup } from "@/lib/catalog/category-showcase";

/** One featured-first query per category; a failed query just drops that category. */
async function loadShowcase(categories: { slug: string; name: string }[]) {
  const groups = await Promise.all(
    categories.map((c): Promise<ShowcaseGroup | null> =>
      searchProducts(parseFilters({}, { category: c.slug, sort: "featured" }), SHOWCASE_PER_CATEGORY)
        .then((r) => ({ slug: c.slug, name: c.name, products: r.products, total: r.total }))
        .catch(() => null),
    ),
  );
  return buildShowcase(groups);
}
import { CustomerReviews } from "@/components/home/customer-reviews";
import { getHomeTestimonials } from "@/lib/reviews/testimonials";

export default async function HomePage() {
  const [tour, featured, newest, facets, rail, identity] = await Promise.all([
    getPublishedHero(),
    searchProducts(parseFilters({ sort: "featured" }), 8),
    searchProducts(parseFilters({}), 4),
    getFacets(),
    searchProducts(parseFilters({ sort: "featured" }), 40),
    getStoreIdentity(),
  ]);
  const showcase = await loadShowcase(facets.categories);
  const testimonials = getHomeTestimonials();

  return (
    <>
      <StoreTour scenes={tour.scenes} settings={tour.settings} />

      <GarmentRail
        garments={railGarments(rail.products)}
        brand={identity.name}
        tagline={identity.tagline || `${identity.name}, on the rail`}
        marquee={[identity.tagline || identity.name, "Cash on delivery across Bangladesh", `${identity.name} Dhaka`]}
      />

      <section id="featured" tabIndex={-1} aria-labelledby="featured-heading" className="scroll-mt-20 outline-none mx-auto max-w-7xl px-4 py-16 sm:px-6">
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

      <section aria-labelledby="new-heading" className="mx-auto mt-16 max-w-7xl px-4 sm:px-6">
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

      <CategoryShowcase showcase={showcase} />

      <CustomerReviews reviews={testimonials.reviews} sample={testimonials.sample} />

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
