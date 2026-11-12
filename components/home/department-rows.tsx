import Image from "next/image";
import Link from "next/link";
import type { Departments } from "@/lib/catalog/departments";
import { mediaUrl } from "@/lib/media/url";
import { TileCarousel } from "./tile-carousel";

/**
 * Home page department rows: a heading with "Explore All", then a scrolling
 * row of tall picture cards with the category name over the bottom-left.
 */
export function DepartmentRows({ departments, brand }: { departments: Departments; brand: string }) {
  if (departments.rows.length === 0) return null;
  const demo = departments.source === "demo";
  return (
    <div className="bg-mist font-catalog text-ink" data-testid="department-rows" data-source={departments.source}>
      {departments.rows.map((row) => {
        const headingId = `dept-${row.key}-heading`;
        return (
          <section key={row.key} aria-labelledby={headingId} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-10" data-testid={`department-${row.key}`}>
            <div className="mb-5 flex items-end justify-between gap-4 md:mb-7">
              <h2 id={headingId} className="text-[28px] font-normal leading-none tracking-tight md:text-[34px]">
                {row.title}
              </h2>
              <Link href={row.href} className="mb-1 text-[11px] font-medium underline underline-offset-2 hover:no-underline">
                Explore All<span className="sr-only"> {row.title}</span>
              </Link>
            </div>
            <TileCarousel label={row.title}>
              {row.tiles.map((t) => (
                <li key={t.key} className="w-[68%] shrink-0 snap-start sm:w-[42%] md:w-[calc((100%-48px)/3.8)]">
                  <Link href={t.href} className="group relative block aspect-[4/5] overflow-hidden rounded-[3px] bg-neutral-300 focus-visible:outline-offset-4" data-testid="department-tile">
                    {t.image ? (
                      <Image
                        src={mediaUrl(t.image)}
                        alt={t.imageAlt}
                        fill
                        sizes="(min-width: 768px) 26vw, (min-width: 640px) 42vw, 68vw"
                        className="object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="absolute inset-0"
                        style={{ backgroundImage: `linear-gradient(160deg, ${t.hex ?? "#bbb"}33, ${t.hex ?? "#999"})` }}
                      />
                    )}
                    <span aria-hidden className="absolute left-4 top-4 text-[9px] font-semibold uppercase tracking-[0.3em] text-neutral-700/80 mix-blend-multiply">
                      {brand}
                    </span>
                    <span aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-neutral-900/55 via-neutral-900/25 to-transparent" />
                    <span className="absolute bottom-6 left-6 right-6 text-xl font-semibold leading-tight text-white md:bottom-7 md:left-8 md:text-[22px]">
                      {t.label}
                    </span>
                  </Link>
                </li>
              ))}
            </TileCarousel>
          </section>
        );
      })}
      {demo ? (
        <p className="mx-auto max-w-7xl px-4 pb-8 text-xs text-neutral-600 sm:px-6">Demo pieces shown until products are published in Admin.</p>
      ) : null}
    </div>
  );
}
