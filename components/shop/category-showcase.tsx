import Link from "next/link";
import type { Showcase } from "@/lib/catalog/category-showcase";
import { CategoryTabs } from "./category-tabs";
import { ProductCard } from "./product-card";

/** Home page "Shop by category": one tab per category, each showing its products. */
export function CategoryShowcase({ showcase }: { showcase: Showcase }) {
  if (showcase.groups.length === 0) return null;
  const demo = showcase.source === "demo";

  return (
    <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-16 sm:px-6" data-testid="category-showcase" data-source={showcase.source}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="categories-heading" className="font-display text-3xl font-semibold text-espresso">Shop by category</h2>
          <p className="mt-1 text-sm text-muted">
            {demo ? "Demo pieces shown until products are published in Admin." : "Pick a category to see what is on the rail."}
          </p>
        </div>
        <Link href="/shop" className="text-sm text-bronze-strong underline">Shop everything</Link>
      </div>
      <div className="mt-6">
        <CategoryTabs
          tabs={showcase.groups.map((g) => ({
            key: g.slug,
            label: g.name,
            panel: (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
                  {g.products.map((p) => (
                    <ProductCard key={p.id} product={p} href={demo ? `/category/${g.slug}` : undefined} />
                  ))}
                </div>
                <div className="mt-8 text-center">
                  <Link
                    href={`/category/${g.slug}`}
                    className="inline-flex items-center rounded border border-espresso px-5 py-2.5 text-sm font-medium text-espresso hover:bg-espresso hover:text-cream"
                  >
                    View all {g.name}
                    {g.total > g.products.length ? ` (${g.total})` : ""}
                  </Link>
                </div>
              </>
            ),
          }))}
        />
      </div>
    </section>
  );
}
