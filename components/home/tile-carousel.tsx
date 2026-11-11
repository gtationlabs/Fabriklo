"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Horizontal row of cards that scrolls by touch, trackpad or the round arrow
 * buttons. The last visible card fades out on the right while there is more
 * to see, as a cue that the row continues.
 */
export function TileCarousel({ label, children }: { label: string; children: ReactNode }) {
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
    const gap = 16;
    const by = card ? card.getBoundingClientRect().width + gap : el.clientWidth * 0.8;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * by, behavior: reduce ? "auto" : "smooth" });
  }

  const arrow =
    "absolute top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-900 bg-white/90 text-neutral-900 transition hover:bg-neutral-900 hover:text-white md:flex";

  return (
    <div className="relative">
      <ul
        ref={track}
        onScroll={measure}
        aria-label={label}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={
          edges.end
            ? undefined
            : { maskImage: "linear-gradient(to right, #000 calc(100% - 64px), transparent)", WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 64px), transparent)" }
        }
      >
        {children}
      </ul>
      {!edges.start ? (
        <button type="button" onClick={() => step(-1)} aria-label={`Scroll ${label} back`} className={`${arrow} left-2`}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
      ) : null}
      {!edges.end ? (
        <button type="button" onClick={() => step(1)} aria-label={`Scroll ${label} forward`} className={`${arrow} right-2`}>
          <ChevronRight aria-hidden className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
