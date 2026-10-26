"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { HeroScene, HeroSettings } from "@/lib/cms/hero";
import { heroBlur, heroSrcSet } from "@/lib/cms/hero-media";

/**
 * Scroll-driven 2.5D walkthrough of the store, built from the owner's flat renders.
 *
 * Progressive enhancement:
 * - Server HTML (no JS, reduced motion, or renderer "static"): every scene is a
 *   normal full-height panel, so all content is readable and linkable.
 * - With JS and motion allowed: the stage is pinned and scrolling scrubs a
 *   GSAP timeline of slow camera push-ins, parallax drift and cross-dissolves
 *   between scenes. Scrolling back up plays it in reverse.
 */
export function StoreTour({
  scenes,
  settings,
  skipTo = "#featured",
}: {
  scenes: HeroScene[];
  settings: HeroSettings;
  skipTo?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<ScrollTrigger | null>(null);
  const [active, setActive] = useState(1);
  const [mode, setMode] = useState<"static" | "tour">("static");
  const n = scenes.length;

  useEffect(() => {
    const el = root.current;
    if (!el || n < 2 || settings.renderer === "static") return;
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });
    const mm = gsap.matchMedia();

    mm.add(
      { motion: "(prefers-reduced-motion: no-preference)", small: "(max-width: 767px)" },
      (ctx) => {
        const { motion, small } = ctx.conditions as { motion: boolean; small: boolean };
        if (!motion) return;
        const strength = settings.motion_strength * (small ? 0.6 : 1);
        const sceneEls = gsap.utils.toArray<HTMLElement>("[data-scene]", el);
        const media = sceneEls.map((s) => s.querySelector<HTMLElement>("[data-media]")!);
        const captions = sceneEls.map((s) => s.querySelector<HTMLElement>("[data-caption]")!);

        el.classList.add("is-tour");
        setMode("tour");

        // Initial state: first scene visible, others waiting.
        sceneEls.forEach((s, i) => {
          gsap.set(s, { autoAlpha: i === 0 ? 1 : 0, zIndex: i + 1 });
          gsap.set(media[i], { scale: scenes[i].zoom, yPercent: 0, transformOrigin: scenes[i].object_position });
          gsap.set(captions[i], { autoAlpha: i === 0 ? 1 : 0, y: i === 0 ? 0 : 40 });
        });

        const tl = gsap.timeline({ defaults: { ease: "none" } });
        tl.addLabel("s1", 0);
        for (let i = 0; i < n; i++) {
          const s = scenes[i];
          const push = 0.12 * strength;
          // Walk forward into the current scene (camera push-in + drift).
          tl.to(
            media[i],
            { scale: s.zoom + push, yPercent: -s.parallax * 100 * strength, duration: 1 },
            i === 0 ? 0 : ">-0.35",
          );
          if (i < n - 1) {
            const next = scenes[i + 1];
            // Cross-dissolve to the next area as if turning the corner.
            tl.to(captions[i], { autoAlpha: 0, y: -40, duration: 0.25 }, "<0.6")
              .fromTo(
                sceneEls[i + 1],
                { autoAlpha: 0 },
                { autoAlpha: 1, duration: 0.4 },
                "<0.05",
              )
              .fromTo(
                media[i + 1],
                { scale: next.zoom + 0.08 * strength },
                { scale: next.zoom, duration: 0.4 },
                "<",
              )
              .to(captions[i + 1], { autoAlpha: 1, y: 0, duration: 0.25 }, "<0.2")
              .addLabel(`s${i + 2}`);
          }
        }

        const st = ScrollTrigger.create({
          trigger: el,
          start: "top top",
          end: () => `+=${(n - 1) * window.innerHeight * 1.1}`,
          pin: el.querySelector<HTMLElement>("[data-stage]")!,
          scrub: 0.6,
          animation: tl,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const t = self.progress * tl.duration();
            const idx = currentScene(tl, n, t);
            setActive(idx);
            sceneEls.forEach((s, i) => s.toggleAttribute("inert", i !== idx - 1));
          },
        });
        trigger.current = st;

        return () => {
          trigger.current = null;
          sceneEls.forEach((s) => s.removeAttribute("inert"));
          el.classList.remove("is-tour");
          setMode("static");
          setActive(1);
        };
      },
    );
    return () => mm.revert();
  }, [n, scenes, settings.motion_strength, settings.renderer]);

  const goTo = useCallback(
    (index: number) => {
      const st = trigger.current;
      const target = root.current?.querySelector<HTMLElement>(`[data-scene="${index}"]`);
      if (!st) {
        target?.scrollIntoView({ behavior: "auto", block: "start" });
        return;
      }
      const tl = st.animation as gsap.core.Timeline;
      const points = sceneSnapPoints(tl, n);
      window.scrollTo({ top: st.start + (st.end - st.start) * points[index - 1]!, behavior: "smooth" });
    },
    [n],
  );

  return (
    <section
      ref={root}
      id="store-tour"
      aria-labelledby="hero-heading"
      aria-roledescription="store tour"
      data-mode={mode}
      data-active-scene={active}
      className="store-tour relative bg-espresso text-cream"
    >
      <div data-stage className="store-tour__stage">
        {scenes.map((s, i) => (
          <article
            key={s.position}
            data-scene={i + 1}
            aria-label={`Scene ${i + 1} of ${n}: ${s.eyebrow || s.heading}`}
            className="store-tour__scene"
          >
            <div className="store-tour__frame" aria-hidden={false}>
              {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimised responsive renders */}
              <img
                data-media
                src={s.image_path}
                srcSet={heroSrcSet(s.image_path)}
                sizes="100vw"
                alt={s.image_alt}
                fetchPriority={i === 0 ? "high" : "low"}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                className="store-tour__img"
                style={{
                  objectPosition: s.object_position,
                  backgroundImage: `url(${heroBlur(s.image_path)})`,
                }}
              />
              <div
                className="store-tour__shade"
                style={{ ["--shade" as string]: String(settings.overlay_opacity) }}
                aria-hidden
              />
            </div>
            <div data-caption className="store-tour__caption">
              <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
                {s.eyebrow ? (
                  <p className="text-sm uppercase tracking-[0.25em] text-cream/80">{s.eyebrow}</p>
                ) : null}
                {i === 0 ? (
                  <h1 id="hero-heading" className="mt-3 max-w-2xl font-display text-5xl font-semibold leading-tight md:text-7xl">
                    {s.heading}
                  </h1>
                ) : (
                  <h2 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight md:text-6xl">{s.heading}</h2>
                )}
                {s.body ? <p className="mt-4 max-w-xl text-lg text-cream/85">{s.body}</p> : null}
                {s.cta_label && s.cta_href ? (
                  <Link
                    href={s.cta_href}
                    className="mt-8 inline-block rounded bg-cream px-6 py-3 font-medium text-espresso hover:bg-white"
                  >
                    {s.cta_label}
                  </Link>
                ) : null}
              </div>
            </div>
          </article>
        ))}

        <div className="store-tour__controls">
          {mode === "tour" ? (
            <nav aria-label="Store tour scenes" className="flex items-center gap-1">
              {scenes.map((s, i) => (
                <button
                  key={s.position}
                  type="button"
                  onClick={() => goTo(i + 1)}
                  aria-label={`Go to scene ${i + 1}: ${s.eyebrow || s.heading}`}
                  aria-current={active === i + 1 ? "step" : undefined}
                  className="group grid h-6 min-w-6 place-items-center rounded-full"
                >
                  <span
                    aria-hidden
                    className={`block h-2.5 rounded-full transition-all ${active === i + 1 ? "w-8 bg-cream" : "w-2.5 bg-cream/45 group-hover:bg-cream/70"}`}
                  />
                </button>
              ))}
              <span className="ml-2 text-xs tabular-nums text-cream/80" aria-live="polite">
                {active} / {n}
              </span>
            </nav>
          ) : null}
          <a
            href={skipTo}
            className="rounded border border-cream/60 bg-espresso/40 px-4 py-2 text-sm font-medium text-cream backdrop-blur hover:bg-cream/10"
          >
            Skip store tour
          </a>
        </div>
      </div>
    </section>
  );
}

/** Timeline time where each scene is fully settled (labels s1..sN), used for the scene dots and indicator. */
function sceneTimes(tl: gsap.core.Timeline, n: number): number[] {
  return Array.from({ length: n }, (_, i) => tl.labels[`s${i + 1}`] ?? 0);
}

function sceneSnapPoints(tl: gsap.core.Timeline, n: number): number[] {
  const total = tl.duration() || 1;
  return sceneTimes(tl, n).map((t) => t / total);
}

function currentScene(tl: gsap.core.Timeline, n: number, t: number): number {
  // The scene whose caption has (almost) fully arrived.
  const times = sceneTimes(tl, n);
  let idx = 0;
  for (let i = 0; i < times.length; i++) if (times[i]! <= t + 0.05) idx = i;
  return idx + 1;
}
