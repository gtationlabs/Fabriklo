"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FIT_LABEL, summarizeReviews, type Testimonial } from "@/lib/reviews/testimonials";

/**
 * "Hang-tag deck" of customer reviews.
 *
 * Progressive enhancement, like the store tour:
 * - Server HTML (no JS or reduced motion): a summary panel plus every review as a
 *   hang tag in a swipeable row (mobile) or grid (desktop). Nothing is hidden.
 * - Desktop with motion allowed: the section pins and the tags sit in a loose
 *   stack. Scrolling flicks the top tag off the pile (alternating left/right) and
 *   the rest shuffle up; scrolling back brings them back. The score counts up and
 *   the star bars fill when the section arrives.
 * - A ribbon of short quotes runs underneath and speeds up with scroll velocity.
 */
export function CustomerReviews({ reviews, sample }: { reviews: Testimonial[]; sample: boolean }) {
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<ScrollTrigger | null>(null);
  const [mode, setMode] = useState<"static" | "deck">("static");
  const [active, setActive] = useState(1);
  const n = reviews.length;
  const summary = summarizeReviews(reviews);

  useEffect(() => {
    const el = root.current;
    if (!el || n === 0) return;
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();

    // Score count-up, bar fill and the quote ribbon: any screen size, motion allowed.
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const score = el.querySelector<HTMLElement>("[data-score]");
      const bars = gsap.utils.toArray<HTMLElement>("[data-bar]", el);
      const ribbon = el.querySelector<HTMLElement>("[data-ribbon-track]");
      const counter = { v: 0 };
      gsap
        .timeline({ scrollTrigger: { trigger: el, start: "top 75%", once: true } })
        .to(counter, {
          v: summary.average,
          duration: 1.4,
          ease: "power2.out",
          onUpdate: () => {
            if (score) score.textContent = counter.v.toFixed(1);
          },
        })
        .from(bars, { scaleX: 0, transformOrigin: "left center", duration: 0.9, ease: "power3.out", stagger: 0.08 }, 0.15);

      if (ribbon) {
        const loop = gsap.to(ribbon, { xPercent: -50, duration: 40, ease: "none", repeat: -1 });
        const speed = { t: 1 };
        const st = ScrollTrigger.create({
          trigger: el,
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => (self.isActive ? loop.play() : loop.pause()),
          onUpdate: (self) => {
            const v = self.getVelocity();
            const boost = Math.min(Math.abs(v) / 250, 6);
            speed.t = (v < 0 ? -1 : 1) * (1 + boost);
            loop.timeScale(speed.t);
            gsap.to(speed, {
              t: 1,
              duration: 0.8,
              overwrite: true,
              onUpdate: () => {
                loop.timeScale(speed.t);
              },
            });
          },
        });
        return () => {
          st.kill();
          loop.kill();
        };
      }
    });

    // The pinned deck: wide screens only, motion allowed.
    mm.add("(prefers-reduced-motion: no-preference) and (min-width: 1024px)", () => {
      const tags = gsap.utils.toArray<HTMLElement>("[data-tag]", el);
      if (tags.length < 2) return;
      el.classList.add("is-deck");
      setMode("deck");

      const slot = (k: number) => ({
        x: k * 14,
        y: k * 22,
        rotation: k === 0 ? -2 : k % 2 ? 3 + k * 1.5 : -3 - k * 1.5,
        scale: 1 - k * 0.045,
        autoAlpha: k > 3 ? 0 : 1,
      });
      tags.forEach((t, i) => gsap.set(t, { ...slot(i), zIndex: n - i, transformOrigin: "50% 0%" }));

      const tl = gsap.timeline({ defaults: { ease: "power1.inOut" } });
      tl.addLabel("r1", 0);
      for (let i = 0; i < n - 1; i++) {
        const dir = i % 2 ? 1 : -1;
        const at = i;
        // Flick the top tag off the pile, swinging from its string hole.
        tl.to(
          tags[i]!,
          { x: dir * 560, y: -120, rotation: dir * 28, autoAlpha: 0, duration: 0.7, ease: "power2.in" },
          at,
        );
        // Everything underneath moves up one slot.
        for (let j = i + 1; j < n; j++) tl.to(tags[j]!, { ...slot(j - i - 1), duration: 0.6 }, at + 0.25);
        tl.addLabel(`r${i + 2}`, at + 0.85);
      }
      tl.to({}, { duration: 0.3 });
      // Follow the (scrubbed, slightly lagging) animation rather than the raw scroll position,
      // so the counter always names the tag that is actually on top.
      tl.eventCallback("onUpdate", () => setActive(currentReview(tl, n, tl.time())));

      const st = ScrollTrigger.create({
        trigger: el,
        start: "top top",
        end: () => `+=${(n - 1) * window.innerHeight * 0.55}`,
        pin: el.querySelector<HTMLElement>("[data-deck-stage]")!,
        scrub: 0.5,
        animation: tl,
        invalidateOnRefresh: true,
        // Measure after the store tour's pin spacing above us.
        refreshPriority: -1,
      });
      trigger.current = st;

      return () => {
        trigger.current = null;
        el.classList.remove("is-deck");
        setMode("static");
        setActive(1);
      };
    });

    return () => mm.revert();
  }, [n, summary.average]);

  const goTo = useCallback(
    (index: number) => {
      const st = trigger.current;
      if (!st) return;
      const tl = st.animation as gsap.core.Timeline;
      const t = tl.labels[`r${index}`] ?? 0;
      window.scrollTo({ top: st.start + (st.end - st.start) * (t / (tl.duration() || 1)) + 2, behavior: "smooth" });
    },
    [],
  );

  if (n === 0) return null;
  const ribbon = reviews.map((r) => ({ id: r.id, text: r.quote, who: `${r.name.split(" ")[0]}, ${r.city}` }));
  const current = reviews[active - 1]!;

  return (
    <section
      ref={root}
      id="reviews"
      aria-labelledby="reviews-heading"
      data-mode={mode}
      data-active-review={active}
      className="customer-reviews relative mt-16 overflow-hidden bg-sand/60"
    >
      <div data-deck-stage className="customer-reviews__stage">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-bronze-strong">Worn &amp; reviewed</p>
            <h2 id="reviews-heading" className="mt-2 font-display text-4xl font-semibold text-espresso md:text-5xl">
              What customers say
            </h2>

            <div className="mt-8 flex items-end gap-4">
              <p className="font-display text-7xl font-semibold leading-none text-espresso tabular-nums">
                <span data-score>{summary.average.toFixed(1)}</span>
                <span className="sr-only"> out of 5</span>
              </p>
              <div className="pb-1">
                <Stars rating={summary.average} className="h-5 w-5" />
                <p className="mt-1 text-sm text-muted">
                  from {summary.count} {sample ? "sample " : ""}reviews
                </p>
              </div>
            </div>

            <dl className="mt-6 max-w-sm space-y-1.5" aria-label="Rating breakdown">
              {summary.distribution.map((share, i) => (
                <div key={i} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                  <dt className="text-muted">{5 - i} star</dt>
                  <dd className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                    <span data-bar className="block h-full rounded-full bg-bronze" style={{ width: `${share * 100}%` }} />
                  </dd>
                  <dd className="text-right tabular-nums text-muted">{Math.round(share * 100)}%</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-charcoal">
              <strong className="font-semibold">{Math.round(summary.trueToSize * 100)}%</strong> say it fits true to size.
            </p>

            {mode === "deck" ? (
              <div className="mt-8 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => goTo(Math.max(1, active - 1))}
                  disabled={active === 1}
                  className="rounded-full border border-espresso/30 px-4 py-2 text-sm font-medium text-espresso hover:bg-espresso hover:text-cream disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-espresso"
                >
                  Previous review
                </button>
                <button
                  type="button"
                  onClick={() => goTo(Math.min(n, active + 1))}
                  disabled={active === n}
                  className="rounded-full border border-espresso/30 px-4 py-2 text-sm font-medium text-espresso hover:bg-espresso hover:text-cream disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-espresso"
                >
                  Next review
                </button>
                <span className="ml-1 text-sm tabular-nums text-muted" aria-live="polite">
                  <span className="sr-only">Review </span>
                  {String(active).padStart(2, "0")} / {String(n).padStart(2, "0")}
                  <span className="sr-only">: {current.title}</span>
                </span>
              </div>
            ) : null}

            {sample ? (
              <p className="mt-6 text-xs text-muted">Sample reviews for preview. Real customer reviews will appear here.</p>
            ) : null}
          </div>

          <ul
            className="customer-reviews__deck"
            aria-label="Customer reviews"
            // The static row scrolls sideways on small screens, so it must be reachable by keyboard.
            tabIndex={mode === "static" ? 0 : undefined}
          >
            {reviews.map((r, i) => (
              <li
                key={r.id}
                data-tag={i + 1}
                className="customer-reviews__tag"
                style={{ ["--swatch" as string]: r.swatch }}
                aria-current={mode === "deck" && active === i + 1 ? "true" : undefined}
              >
                <article aria-label={`Review by ${r.name}`} className="customer-reviews__card">
                  <span className="customer-reviews__hole" aria-hidden />
                  <div className="flex items-center justify-between gap-3">
                    <Stars rating={r.rating} className="h-4 w-4" />
                    <span className="text-[0.7rem] uppercase tracking-[0.2em] text-muted">{FIT_LABEL[r.fit]}</span>
                  </div>
                  <h3 className="mt-4 font-display text-2xl font-semibold leading-snug text-espresso">“{r.title}”</h3>
                  <p className="mt-3 text-[0.95rem] leading-relaxed text-charcoal">{r.body}</p>
                  <footer className="mt-6 flex items-end justify-between gap-3 border-t border-dashed border-line pt-4 text-sm">
                    <div>
                      <p className="font-semibold text-espresso">{r.name}</p>
                      <p className="text-muted">{r.city}</p>
                    </div>
                    <p className="text-right text-muted">
                      {r.product}
                      <br />
                      <span className="tabular-nums">Size {r.size}</span>
                    </p>
                  </footer>
                </article>
              </li>
            ))}
          </ul>
        </div>

        <div className="customer-reviews__ribbon" aria-hidden>
          <div data-ribbon-track className="customer-reviews__ribbon-track">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center">
                {ribbon.map((q) => (
                  <span key={`${copy}-${q.id}`} className="flex items-center whitespace-nowrap px-6">
                    <span className="font-display text-2xl italic text-cream md:text-3xl">{q.text}</span>
                    <span className="ml-3 text-xs uppercase tracking-[0.2em] text-cream/60">{q.who}</span>
                    <span className="ml-12 text-bronze">✦</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className="flex items-center gap-0.5 text-bronze" role="img" aria-label={`Rated ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((s) => {
        const fill = Math.max(0, Math.min(1, rating - s + 1));
        return (
          <svg key={s} viewBox="0 0 20 20" className={className} aria-hidden>
            <defs>
              <linearGradient id={`star-${s}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor="currentColor" />
                <stop offset={`${fill * 100}%`} stopColor="currentColor" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <path
              fill={`url(#star-${s}-${Math.round(fill * 100)})`}
              d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z"
            />
          </svg>
        );
      })}
    </span>
  );
}

/** The review whose tag is on top of the pile at timeline time `t`. */
function currentReview(tl: gsap.core.Timeline, n: number, t: number): number {
  let idx = 1;
  for (let i = 1; i <= n; i++) if ((tl.labels[`r${i}`] ?? 0) <= t + 0.05) idx = i;
  return idx;
}
