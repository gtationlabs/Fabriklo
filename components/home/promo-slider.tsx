"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HomeSlide } from "@/lib/cms/slides";

/** Home promo banners managed in Admin → Slider. Auto-advances unless the visitor prefers reduced motion. */
export function PromoSlider({ slides }: { slides: HomeSlide[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  useEffect(() => {
    if (n < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), 6000);
    return () => clearInterval(t);
  }, [n, paused]);
  if (!n) return null;
  return (
    <section aria-roledescription="carousel" aria-label="Promotions" className="mx-auto max-w-7xl px-4 pt-10 sm:px-6" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} data-testid="promo-slider">
      <div className="relative overflow-hidden rounded-lg bg-espresso">
        <div className="flex transition-transform duration-700 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${i * 100}%)` }}>
          {slides.map((s, k) => (
            <div key={s.id} role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}`} aria-hidden={k !== i} className="relative aspect-[16/9] w-full shrink-0 sm:aspect-[16/6]">
              {/* eslint-disable-next-line @next/next/no-img-element -- banner from our own bucket, sized by the admin */}
              <img src={s.image} alt={s.alt} loading={k === 0 ? "eager" : "lazy"} className="absolute inset-0 h-full w-full object-cover" />
              <div className={`absolute inset-0 ${s.theme === "dark" ? "bg-gradient-to-r from-black/60 via-black/25 to-transparent text-white" : "bg-gradient-to-r from-white/70 via-white/30 to-transparent text-espresso"}`} />
              <div className={`relative flex h-full max-w-xl flex-col justify-center gap-3 p-6 sm:p-12 ${s.theme === "dark" ? "text-white" : "text-espresso"}`}>
                {s.eyebrow ? <p className="text-xs uppercase tracking-[0.25em] opacity-80">{s.eyebrow}</p> : null}
                <h2 className="font-display text-2xl font-semibold sm:text-5xl">{s.title}</h2>
                {s.subtitle ? <p className="text-sm opacity-90 sm:text-base">{s.subtitle}</p> : null}
                {s.href && s.cta ? (
                  <Link href={s.href} tabIndex={k === i ? 0 : -1} className={`mt-2 w-fit rounded border px-5 py-2.5 text-sm font-medium ${s.theme === "dark" ? "border-white/70 hover:bg-white hover:text-espresso" : "border-espresso hover:bg-espresso hover:text-cream"}`}>
                    {s.cta}
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {n > 1 ? (
          <>
            <button type="button" onClick={() => setI((i - 1 + n) % n)} className="absolute left-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-espresso hover:bg-white" aria-label="Previous slide"><ChevronLeft className="size-5" aria-hidden /></button>
            <button type="button" onClick={() => setI((i + 1) % n)} className="absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-espresso hover:bg-white" aria-label="Next slide"><ChevronRight className="size-5" aria-hidden /></button>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
              {slides.map((s, k) => (
                <button key={s.id} type="button" onClick={() => setI(k)} aria-label={`Show slide ${k + 1}`} aria-current={k === i} className={`h-2 rounded-full transition-all ${k === i ? "w-6 bg-white" : "w-2 bg-white/60"}`} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
