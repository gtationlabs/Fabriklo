import Image from "next/image";
import Link from "next/link";
import { ChevronUp } from "lucide-react";
import { mediaUrl } from "@/lib/media/url";
import { demoArtPath } from "@/lib/catalog/demo-catalog";
import type { ProductCard as Card } from "@/lib/catalog/queries";
import { formatBDTCode } from "@/lib/money";
import { discountLabel } from "@/lib/catalog/product-page";
import { DemoBadge } from "@/components/ui/demo-badge";
import { ProductArt } from "./product-art";

/** Shopping bag with a plus: the quick-add mark in the corner of each picture. */
function BagPlus({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M5 8h14l-1 12H6L5 8Z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
      <path d="M12 11.5v5M9.5 14h5" />
    </svg>
  );
}

/**
 * Catalogue card: tall picture with a quick-add bag in the corner, then the
 * name with its style code, a colour count that opens the swatches, and the
 * price in BDT.
 */
export function ProductCard({ product, href }: { product: Card; href?: string }) {
  const soldOut = product.available <= 0;
  const to = href ?? `/product/${product.slug}`;
  // Demo products without an uploaded photo show their generated illustration.
  const image = product.image_path ?? (product.is_demo ? demoArtPath(product.slug) : null);
  const onSale = product.max_compare_at_minor != null && product.max_compare_at_minor > product.min_price_minor;
  const colours = product.colors.length;

  return (
    <article className="group flex flex-col font-catalog text-ink" data-testid="product-card">
      <div className="relative">
        <Link href={to} tabIndex={-1} aria-hidden className="block overflow-hidden rounded-[3px] bg-neutral-200">
          {image ? (
            <div className="relative aspect-[4/5] w-full">
              <Image
                src={mediaUrl(image)}
                alt={product.image_alt ?? product.title}
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
                className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
              />
            </div>
          ) : (
            <ProductArt title={product.title} hex={product.colors[0]?.hex} className="transition group-hover:brightness-95" />
          )}
        </Link>
        {onSale ? (
          <span className="absolute right-3 top-3 rounded-[3px] bg-danger px-2.5 py-0.5 text-[11px] font-medium text-white">Sale</span>
        ) : null}
        <div className="absolute inset-x-3 bottom-3 flex gap-2 md:inset-x-4 md:bottom-4">
          <Link
            href={to}
            aria-label={soldOut ? `View ${product.title} (out of stock)` : `Add ${product.title} to bag (choose a size)`}
            title={soldOut ? "View product" : "Add to bag"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] bg-white text-ink shadow-sm transition hover:bg-ink hover:text-white"
          >
            <BagPlus className="h-[18px] w-[18px]" />
          </Link>
          {soldOut ? (
            <span className="flex h-9 flex-1 items-center justify-center rounded-[4px] bg-white/95 text-[12px] text-danger shadow-sm" data-testid="out-of-stock">
              Out Of Stock
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <h3 className="text-[14px] leading-snug md:text-[15px]">
          <Link href={to} className="hover:underline underline-offset-2">
            {product.title}
          </Link>
        </h3>
        {product.style_code ? (
          <span className="shrink-0 pt-0.5 text-[11px] tracking-wide text-neutral-600" title="Style code">
            {product.style_code}
          </span>
        ) : null}
      </div>

      {colours > 0 ? (
        <details className="group/colors mt-1 text-[12px] text-neutral-600">
          <summary className="inline-flex cursor-pointer list-none items-center gap-0.5 [&::-webkit-details-marker]:hidden">
            {colours} {colours === 1 ? "color" : "colors"}
            <ChevronUp aria-hidden className="h-3 w-3 rotate-180 transition group-open/colors:rotate-0" />
          </summary>
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Colours of ${product.title}`}>
            {product.colors.map((c) => (
              <li key={c.name} className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-full border border-neutral-300" style={{ backgroundColor: c.hex ?? "#ccc" }} aria-hidden />
                {c.name}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-[14px] font-semibold md:text-[15px]">
        <span>
          <span className="sr-only">From </span>
          {formatBDTCode(product.min_price_minor)}
        </span>
        {onSale ? (
          <>
            <s className="text-[13px] font-normal text-neutral-600">
              <span className="sr-only">Was </span>
              {formatBDTCode(product.max_compare_at_minor)}
            </s>
            <span className="text-[13px] font-normal text-danger">{discountLabel(product.min_price_minor, product.max_compare_at_minor)}</span>
          </>
        ) : null}
      </p>
      {product.is_demo ? <DemoBadge className="mt-1.5 self-start" /> : null}
    </article>
  );
}
