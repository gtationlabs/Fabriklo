"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Titled row of product cards ("You May Also Like", "Recently Viewed"):
 * a large heading with square arrow buttons on the right, and a track that
 * scrolls by touch or trackpad. Cards are a fixed width so the next one peeks
 * in at the edge.
 */
export function ProductCarousel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  function step(dir: 1 | -1) {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector("li");
    const by = card ? card.getBoundingClientRect().width + 18 : el.clientWidth * 0.8;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * by, behavior: reduce ? "auto" : "smooth" });
  }

  const btn =
    "flex h-9 w-9 items-center justify-center rounded-[4px] bg-white text-ink shadow-[0_1px_4px_rgba(0,0,0,0.12)] transition hover:bg-ink hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-ink";
  const scrollable = !(edges.start && edges.end);

  return (
    <section aria-labelledby={`${id}-heading`} className="font-catalog" data-testid={id}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 id={`${id}-heading`} className="text-[28px] font-medium tracking-tight text-ink md:text-[36px]">
          {title}
        </h2>
        {scrollable ? (
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => step(-1)} disabled={edges.start} aria-label={`Scroll ${title} back`}>
              <ChevronLeft aria-hidden className="h-4 w-4" />
            </button>
            <button type="button" className={btn} onClick={() => step(1)} disabled={edges.end} aria-label={`Scroll ${title} forward`}>
              <ChevronRight aria-hidden className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
      <ul
        ref={track}
        onScroll={measure}
        className="relative -mx-4 flex snap-x snap-mandatory gap-[18px] overflow-x-auto scroll-smooth px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
    </section>
  );
}

/** One slot in the track: about four and a half cards across on desktop. */
export function CarouselItem({ children }: { children: ReactNode }) {
  return <li className="relative w-[62%] shrink-0 snap-start sm:w-[40%] md:w-[29%] lg:w-[21.5%]">{children}</li>;
}
