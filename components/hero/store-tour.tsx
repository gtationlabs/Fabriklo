"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { HeroScene, HeroSettings } from "@/lib/cms/hero";
import { heroBlur, heroSrcSet } from "@/lib/cms/hero-media";
import { cameraTurn, focusX, turnPoses } from "@/lib/cms/hero-camera";

/**
 * Scroll-driven 3D walkthrough of the store, built from the owner's flat renders.
 *
 * Progressive enhancement:
 * - Server HTML (no JS, reduced motion, or renderer "static"): every scene is a
 *   normal full-height panel, so all content is readable and linkable.
 * - With JS and motion allowed: the stage is pinned and scrolling scrubs a GSAP
 *   timeline that moves a perspective camera through the store: it walks
 *   forward into each area (dolly in on the scene's focus point), then turns
 *   left or right toward the next area (3D swing with rotateY), or walks
 *   straight through when the next area is ahead. On desktop the room also
 *   tilts slightly with the pointer. Scrolling back up plays it in reverse.
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
      {
        motion: "(prefers-reduced-motion: no-preference)",
        small: "(max-width: 767px)",
        finePointer: "(hover: hover) and (pointer: fine)",
      },
      (ctx) => {
        const { motion, small, finePointer } = ctx.conditions as { motion: boolean; small: boolean; finePointer: boolean };
        if (!motion) return;
        const strength = settings.motion_strength * (small ? 0.65 : 1);
        const stage = el.querySelector<HTMLElement>("[data-stage]")!;
        const sceneEls = gsap.utils.toArray<HTMLElement>("[data-scene]", el);
        const cams = sceneEls.map((s) => s.querySelector<HTMLElement>("[data-cam]")!);
        const media = sceneEls.map((s) => s.querySelector<HTMLElement>("[data-media]")!);
        const captions = sceneEls.map((s) => s.querySelector<HTMLElement>("[data-caption]")!);

        el.classList.add("is-tour");
        setMode("tour");
        // Hidden scenes are revealed by scroll, so load them now instead of popping in later.
        media.forEach((m) => m instanceof HTMLImageElement && (m.loading = "eager"));

        // Initial state: first scene visible, others waiting.
        sceneEls.forEach((s, i) => {
          gsap.set(s, { autoAlpha: i === 0 ? 1 : 0, zIndex: i + 1 });
          gsap.set(media[i], {
            scale: scenes[i].zoom,
            z: 0,
            xPercent: 0,
            yPercent: 0,
            rotationY: 0,
            transformOrigin: scenes[i].object_position,
          });
          gsap.set(captions[i], { autoAlpha: i === 0 ? 1 : 0, y: i === 0 ? 0 : 40 });
        });

        const blur = !small; // a little motion blur mid-turn; skipped on phones to save GPU.
        const tl = gsap.timeline({ defaults: { ease: "none" } });
        tl.addLabel("s1", 0);
        for (let i = 0; i < n; i++) {
          const s = scenes[i];
          // Walk forward into the current area: dolly in on its focus point with a gentle drift.
          tl.to(media[i], {
            z: WALK_Z * strength,
            yPercent: -s.parallax * 100 * strength,
            rotationY: (focusX(s.object_position) - 50) * 0.06 * strength,
            duration: 1,
          });
          if (i < n - 1) {
            const next = scenes[i + 1];
            const { leave, enter } = turnPoses(cameraTurn(next.object_position), strength);
            const T = 0.8;
            tl.addLabel(`turn${i + 1}`)
              .to(captions[i], { autoAlpha: 0, y: -40, duration: 0.2 }, `turn${i + 1}`)
              .to(
                media[i],
                {
                  z: WALK_Z * strength + leave.z,
                  xPercent: leave.xPercent,
                  rotationY: leave.rotationY,
                  filter: blur ? "blur(6px)" : "none",
                  duration: T,
                  ease: "power1.in",
                },
                `turn${i + 1}`,
              )
              .to(sceneEls[i], { autoAlpha: 0, duration: T * 0.6 }, `turn${i + 1}+=${T * 0.4}`)
              .fromTo(sceneEls[i + 1], { autoAlpha: 0 }, { autoAlpha: 1, duration: T * 0.55 }, `turn${i + 1}+=${T * 0.15}`)
              .fromTo(
                media[i + 1],
                { ...enter, yPercent: 0, filter: blur ? "blur(6px)" : "none" },
                { z: 0, xPercent: 0, rotationY: 0, filter: "blur(0px)", duration: T, ease: "power2.out" },
                `turn${i + 1}+=${T * 0.15}`,
              )
              .to(captions[i + 1], { autoAlpha: 1, y: 0, duration: 0.25 }, `turn${i + 1}+=${T * 0.7}`)
              .addLabel(`s${i + 2}`);
          }
        }

        const st = ScrollTrigger.create({
          trigger: el,
          start: "top top",
          end: () => `+=${(n - 1) * window.innerHeight * 1.4}`,
          pin: stage,
          scrub: 0.8,
          animation: tl,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const t = self.progress * tl.duration();
            const idx = currentScene(tl, n, t);
            setActive(idx);
            stage.style.setProperty("--tour-progress", self.progress.toFixed(4));
            el.toggleAttribute("data-walking", self.progress > 0.01);
            sceneEls.forEach((s, i) => s.toggleAttribute("inert", i !== idx - 1));
          },
        });
        trigger.current = st;

        // Arrival: the camera steps through the door once, so the hero is clearly 3D before any scroll.
        const intro =
          window.scrollY < 10
            ? gsap.from(cams[0], { z: -260 * strength, rotationX: 6 * strength, duration: 1.8, ease: "power3.out" })
            : null;

        // Look around: the room tilts a little toward the pointer (desktop only).
        let onMove: ((e: PointerEvent) => void) | null = null;
        let onLeave: (() => void) | null = null;
        if (finePointer) {
          const rx = cams.map((c) => gsap.quickTo(c, "rotationX", { duration: 0.8, ease: "power3.out" }));
          const ry = cams.map((c) => gsap.quickTo(c, "rotationY", { duration: 0.8, ease: "power3.out" }));
          onMove = (e) => {
            const r = stage.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;
            const py = (e.clientY - r.top) / r.height - 0.5;
            rx.forEach((f) => f(-py * 4 * strength));
            ry.forEach((f) => f(px * 6 * strength));
          };
          onLeave = () => {
            rx.forEach((f) => f(0));
            ry.forEach((f) => f(0));
          };
          stage.addEventListener("pointermove", onMove);
          stage.addEventListener("pointerleave", onLeave);
        }

        return () => {
          intro?.kill();
          if (onMove) stage.removeEventListener("pointermove", onMove);
          if (onLeave) stage.removeEventListener("pointerleave", onLeave);
          trigger.current = null;
          sceneEls.forEach((s) => s.removeAttribute("inert"));
          stage.style.removeProperty("--tour-progress");
          el.removeAttribute("data-walking");
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
            <div className="store-tour__frame">
              <div data-cam className="store-tour__cam">
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
              </div>
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

        {mode === "tour" ? (
          <>
            <div className="store-tour__progress" aria-hidden />
            <p className="store-tour__hint" aria-hidden>
              <span className="store-tour__mouse" />
              Scroll to walk in
            </p>
          </>
        ) : null}

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

/** How far the camera dollies into each area before turning (px of translateZ at 1100px perspective). */
const WALK_Z = 100;

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
