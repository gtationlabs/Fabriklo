import Link from "next/link";
import type { ProductCard as Card } from "@/lib/catalog/queries";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Price } from "./price";
import { ProductArt } from "./product-art";

export function ProductCard({ product }: { product: Card }) {
  const soldOut = product.available <= 0;
  return (
    <article className="group relative flex flex-col gap-2" data-testid="product-card">
      <Link href={`/product/${product.slug}`} className="block focus-visible:outline-offset-4">
        <div className="relative">
          <ProductArt title={product.title} hex={product.colors[0]?.hex} className="transition group-hover:brightness-95" />
          {soldOut ? (
            <span className="absolute left-2 top-2 rounded-sm bg-charcoal/85 px-2 py-0.5 text-xs text-cream">Sold out</span>
          ) : product.max_compare_at_minor ? (
            <span className="absolute left-2 top-2 rounded-sm bg-danger px-2 py-0.5 text-xs text-white">Sale</span>
          ) : null}
        </div>
        <h3 className="mt-2 text-sm font-medium text-espresso">
          <span className="absolute inset-0" aria-hidden />
          {product.title}
        </h3>
      </Link>
      <p className="text-xs text-muted">{product.subtitle}</p>
      <div className="flex items-center justify-between gap-2 text-sm">
        <Price minor={product.min_price_minor} compareAtMinor={product.max_compare_at_minor} from />
        <span className="flex gap-1" aria-label={`${product.colors.length} colours`}>
          {product.colors.slice(0, 4).map((c) => (
            <span
              key={c.name}
              title={c.name}
              className="h-3 w-3 rounded-full border border-line"
              style={{ backgroundColor: c.hex ?? "#ccc" }}
            />
          ))}
        </span>
      </div>
      {product.is_demo ? <DemoBadge className="self-start" /> : null}
    </article>
  );
}
