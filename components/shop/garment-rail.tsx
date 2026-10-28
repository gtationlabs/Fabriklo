"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GarmentArt, type GarmentKind } from "./garment-art";

export type RailGarment = {
  slug: string;
  title: string;
  /** e.g. "T-Shirts · Charcoal" */
  detail: string;
  kind: GarmentKind;
  hex: string | null;
  photo: string | null;
  photoAlt: string | null;
};

/**
 * "On the rail": a clothes rail of garments hung side-on. Hovering (or focusing)
 * a garment turns it to face you and nudges its neighbours apart; clicking opens
 * it in a focused view over a blurred page, with a front/back turn and a link to
 * the product page.
 */
export function GarmentRail({
  garments,
  brand,
  tagline,
  place = "Dhaka",
  marquee,
}: {
  garments: RailGarment[];
  brand: string;
  tagline: string;
  place?: string;
  marquee: string[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [side, setSide] = useState<"front" | "back">("front");
  const dialog = useRef<HTMLDialogElement>(null);
  const openers = useRef<(HTMLButtonElement | null)[]>([]);
  const n = garments.length;

  const show = useCallback((i: number) => {
    setSide("front");
    setOpen(i);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open !== null && !d.open) {
      d.showModal();
      document.documentElement.style.overflow = "hidden";
    }
    if (open === null && d.open) d.close();
  }, [open]);

  const onClose = () => {
    document.documentElement.style.overflow = "";
    const last = open;
    setOpen(null);
    setHovered(null);
    if (last !== null) openers.current[last]?.focus({ preventScroll: true });
  };

  const onDialogKey = (e: React.KeyboardEvent) => {
    if (open === null) return;
    if (e.key === "ArrowRight") show((open + 1) % n);
    else if (e.key === "ArrowLeft") show((open - 1 + n) % n);
  };

  if (n === 0) return null;
  const g = open !== null ? garments[open] : null;
  const label = hovered !== null ? garments[hovered].title : tagline;
  const strip = [...marquee, ...marquee];

  return (
    <section aria-labelledby="rail-heading" className="relative overflow-hidden bg-paper pt-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="rail-heading" className="flex items-center justify-center gap-4 text-[11px] uppercase tracking-[0.2em]">
          <span className="text-charcoal">On the rail</span>
          <span aria-hidden className="h-4 w-px bg-line" />
          <span className="text-muted">
            {brand} / {place}
          </span>
        </h2>

        {/* Rail */}
        <div className="relative mt-8 overflow-x-auto pb-2 [scrollbar-width:none]">
          <div
            className="relative mx-auto w-max px-3 [--open:var(--rest)] [--rest:32px] sm:px-10 sm:[--open:196px] sm:[--rest:54px]"
          >
            <div aria-hidden className="absolute inset-x-0 top-0 h-[6px] rounded-full bg-gradient-to-b from-[#e9e6e1] via-[#b9b4ad] to-[#8f8a83] shadow-sm" />
            <span aria-hidden className="absolute left-0 top-[-5px] h-4 w-2.5 rounded-sm border border-[#a29d96] bg-gradient-to-r from-[#ddd9d3] to-[#a9a49d]" />
            <span aria-hidden className="absolute right-0 top-[-5px] h-4 w-2.5 rounded-sm border border-[#a29d96] bg-gradient-to-r from-[#ddd9d3] to-[#a9a49d]" />

            <ul
              className="relative flex justify-center"
              style={{ minWidth: `calc(${n - 1} * var(--rest) + var(--open))` }}
              onPointerLeave={() => setHovered(null)}
            >
              {garments.map((item, i) => {
                const turned = hovered === i;
                return (
                  <li key={item.slug} className="relative">
                    <button
                      ref={(el) => {
                        openers.current[i] = el;
                      }}
                      type="button"
                      data-testid="rail-garment"
                      data-turned={turned || undefined}
                      aria-label={`${item.title}: open`}
                      onPointerEnter={() => setHovered(i)}
                      onFocus={() => setHovered(i)}
                      onBlur={() => setHovered((h) => (h === i ? null : h))}
                      onClick={() => show(i)}
                      className={`group relative block h-[190px] cursor-pointer outline-none transition-[width] duration-500 ease-[cubic-bezier(.2,.7,.2,1)] sm:h-[268px] ${
                        turned ? "w-[120px] sm:w-[196px]" : "w-[var(--rest)]"
                      }`}
                    >
                      {/* wire from the rail */}
                      <span aria-hidden className="absolute left-1/2 top-[6px] h-[16px] w-px -translate-x-1/2 bg-[#a8a39c]" />
                      <span aria-hidden className="absolute inset-x-0 top-[22px] bottom-0 [perspective:700px]">
                        <span
                          className="absolute left-1/2 top-0 block w-[120px] -translate-x-1/2 transition-[transform,filter] duration-500 ease-[cubic-bezier(.2,.7,.2,1)] sm:w-[180px]"
                          style={{ transform: `rotateY(${turned ? 0 : 74}deg)`, filter: turned ? "none" : "brightness(0.88)" }}
                        >
                          <Hanger />
                          <Garment item={item} side="front" brand={brand} className="-mt-[14px]" />
                        </span>
                      </span>
                      <span className="pointer-events-none absolute inset-x-0 -bottom-2 mx-auto block h-0.5 w-6 rounded-full bg-bronze opacity-0 group-focus-visible:opacity-100" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="min-h-[1.5rem] text-sm text-charcoal" aria-live="polite" data-testid="rail-label">
            {label}
          </p>
          <p className="mt-1 text-xs text-muted">
            <span className="[@media(hover:none)]:hidden">Hover to turn · Click to explore</span>
            <span className="hidden [@media(hover:none)]:inline">Tap a piece to explore</span>
          </p>
          <Link
            href="/shop"
            className="mt-7 inline-flex items-center gap-6 rounded-full border border-line bg-paper px-5 py-2 text-xs text-charcoal transition hover:border-bronze"
          >
            Explore {brand} <span aria-hidden>↗</span>
          </Link>
        </div>
      </div>

      {/* Marquee band */}
      <div className="mt-14 overflow-hidden bg-[#c2410c] py-2.5 text-xs text-white" aria-hidden>
        <div className="flex w-max animate-[rail-marquee_38s_linear_infinite] motion-reduce:animate-none">
          {strip.map((t, i) => (
            <span key={i} className="flex items-center gap-24 pr-24 whitespace-nowrap">
              {t}
              <Spark />
            </span>
          ))}
        </div>
      </div>
      <p className="sr-only">{marquee.join(". ")}</p>

      {/* Focused view */}
      <dialog
        ref={dialog}
        onClose={onClose}
        onKeyDown={onDialogKey}
        aria-labelledby="rail-dialog-title"
        className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-paper/70 p-0 text-charcoal backdrop-blur-xl backdrop:bg-transparent open:flex"
      >
        {g && open !== null ? (
          <div
            className="relative flex h-full w-full flex-col items-center justify-center overflow-y-auto px-4 py-16"
            onClick={(e) => {
              if (e.target === e.currentTarget) dialog.current?.close();
            }}
          >
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="absolute right-5 top-5 flex items-center gap-3 rounded px-2 py-1 text-xs text-charcoal sm:right-10 sm:top-8"
            >
              Close <span aria-hidden className="text-lg leading-none">✕</span>
            </button>

            <div className="relative flex flex-col items-center">
              <span aria-hidden className="h-10 w-px bg-[#a8a39c]" />
              <div key={open} className="[perspective:1200px] animate-[rail-turn-in_700ms_cubic-bezier(.2,.7,.2,1)]">
                <div
                  data-testid="rail-flip"
                  data-side={side}
                  className="relative w-[230px] transition-transform duration-700 ease-[cubic-bezier(.4,.1,.2,1)] [transform-style:preserve-3d] sm:w-[300px]"
                  style={{ transform: `rotateY(${side === "back" ? 180 : 0}deg)` }}
                >
                  <div className="[backface-visibility:hidden]">
                    <Hanger />
                    <Garment item={g} side="front" brand={brand} className="-mt-[22px]" />
                  </div>
                  <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                    <Hanger />
                    <Garment item={g} side="back" brand={brand} className="-mt-[22px]" />
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-6 text-[10px] tracking-[0.2em] text-muted">
              {String(open + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
            </p>
            <h3 id="rail-dialog-title" className="mt-2 text-center text-xl uppercase tracking-wide text-espresso sm:text-2xl">
              {g.title}
            </h3>
            <p className="mt-1 text-xs text-muted">{g.detail}</p>

            {g.photo ? null : (
              <div className="mt-5 flex gap-5 text-xs" role="group" aria-label="View side">
                {(["front", "back"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={side === s}
                    onClick={() => setSide(s)}
                    className={`border-b pb-1 capitalize transition ${side === s ? "border-charcoal text-charcoal" : "border-transparent text-muted hover:text-charcoal"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-5 flex w-full max-w-[16rem] items-center justify-between border-t border-line pt-4 text-xs sm:max-w-xs">
              <span className="text-charcoal">{brand}</span>
              <Link href={`/product/${g.slug}`} className="text-[#b23c0b] hover:underline">
                View in the shop <span aria-hidden>↗</span>
              </Link>
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}

function Hanger() {
  return (
    <svg viewBox="0 0 200 40" className="relative z-10 block w-full" aria-hidden focusable="false">
      <path d="M100 0 V6 Q100 12 105 12" fill="none" stroke="#9c978f" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M100 13 L36 33 Q30 36 34 38 L166 38 Q170 36 164 33 Z" fill="#8a5a36" />
      <path d="M100 13 L36 33 Q30 36 34 38 L166 38" fill="none" stroke="#5e3b22" strokeWidth="1" />
    </svg>
  );
}

function Garment({ item, side, brand, className = "" }: { item: RailGarment; side: "front" | "back"; brand: string; className?: string }) {
  if (item.photo && side === "front") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.photo} alt={item.photoAlt ?? item.title} className={`block aspect-[200/244] w-full object-contain ${className}`} loading="lazy" />
    );
  }
  return <GarmentArt kind={item.kind} hex={item.hex} side={side} brand={brand} className={`block w-full drop-shadow-[0_10px_12px_rgba(43,29,20,0.18)] ${className}`} />;
}

function Spark() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current" aria-hidden focusable="false">
      <path d="M8 0 C8.6 5 11 7.4 16 8 C11 8.6 8.6 11 8 16 C7.4 11 5 8.6 0 8 C5 7.4 7.4 5 8 0 Z" />
    </svg>
  );
}
