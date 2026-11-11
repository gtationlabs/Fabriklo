"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, MapPin, Ruler, ShoppingBag, X } from "lucide-react";
import { compareSizes } from "@/lib/catalog/sizes";
import { discountLabel, type ShareLink } from "@/lib/catalog/product-page";
import { mediaUrl } from "@/lib/media/url";
import { formatBDTCode } from "@/lib/money";
import { GarmentArt, type GarmentKind } from "./garment-art";
import { ProductArt } from "./product-art";
import { ShareIcon } from "./share-icons";

export type ViewVariant = {
  id: string;
  sku: string;
  size: string;
  color: string;
  color_hex: string | null;
  price_minor: number;
  compare_at_minor: number | null;
  available: number;
};

export type ViewPhoto = { id: string; src: string; alt: string; color: string | null };

export type StoreInfo = { name: string; address: string; hours: string; phone: string | null };

type Slide =
  | { key: string; type: "photo"; src: string; alt: string }
  | { key: string; type: "art"; kind: GarmentKind; hex: string | null; side: "front" | "back"; alt: string };

/**
 * Product page body: gallery on the left, buying panel on the right. They
 * share the chosen colour, so picking a colour swaps the pictures too.
 */
export function ProductView({
  title,
  code,
  brand,
  variants,
  photos,
  demoArt,
  artKind,
  shares,
  store,
  children,
}: {
  title: string;
  code: string | null;
  brand: string;
  variants: ViewVariant[];
  /** Uploaded photos (try-on garment shots excluded). */
  photos: ViewPhoto[];
  /** Generated illustration of a demo product (drawn in its first colour). */
  demoArt: string | null;
  /** Silhouette used to draw colour views while there are no photos; null for accessories. */
  artKind: GarmentKind | null;
  shares: ShareLink[];
  store: StoreInfo;
  /** Extra blocks under the buttons (try-on, details). */
  children?: ReactNode;
}) {
  const colors = useMemo(() => [...new Map(variants.map((v) => [v.color, v.color_hex])).entries()], [variants]);
  const [color, setColor] = useState(colors[0]?.[0] ?? "");
  const hex = colors.find(([c]) => c === color)?.[1] ?? null;

  const slidesFor = (c: string, h: string | null): Slide[] => {
    if (photos.length) {
      const own = photos.filter((p) => p.color === c || p.color === null);
      return (own.length ? own : photos).map((p) => ({ key: p.id, type: "photo", src: p.src, alt: p.alt }));
    }
    const out: Slide[] = [];
    if (artKind) out.push({ key: `front-${c}`, type: "art", kind: artKind, hex: h, side: "front", alt: `Illustration of the ${title} in ${c}, front (demo artwork)` });
    if (demoArt && c === colors[0]?.[0]) out.push({ key: "demo-art", type: "photo", src: demoArt, alt: `Illustration of the ${title} (demo product)` });
    if (artKind) out.push({ key: `back-${c}`, type: "art", kind: artKind, hex: h, side: "back", alt: `Illustration of the ${title} in ${c}, back (demo artwork)` });
    if (!artKind && demoArt && out.length === 0) out.push({ key: "demo-art", type: "photo", src: demoArt, alt: `Illustration of the ${title} (demo product)` });
    return out;
  };
  const slides = slidesFor(color, hex);

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
      <div className="md:sticky md:top-24 md:self-start">
        <Gallery key={color} title={title} brand={brand} slides={slides} hex={hex} />
      </div>
      <div className="md:pt-1">
        <h1 className="text-[26px] font-medium leading-tight text-ink md:text-[28px]">{title}</h1>
        {code ? (
          <p className="mt-1 text-[16px] text-neutral-600" data-testid="product-code">
            Product Code: {code}
          </p>
        ) : null}
        <BuyPanel
          variants={variants}
          colors={colors}
          color={color}
          onColor={setColor}
          swatch={(c, h) => <ColorThumb title={title} slide={slidesFor(c, h)[0]} hex={h} />}
        />
        <FindInStore title={title} code={code} store={store} />
        <ul className="mt-6 flex items-center justify-center gap-5" aria-label="Share this product">
          {shares.map((s) => (
            <li key={s.network}>
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                title={s.label}
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition hover:bg-neutral-200"
              >
                <ShareIcon network={s.network} className="h-6 w-6" />
              </a>
            </li>
          ))}
        </ul>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ gallery */

function Gallery({ title, brand, slides, hex }: { title: string; brand: string; slides: Slide[]; hex: string | null }) {
  const [index, setIndex] = useState(0);
  const touch = useRef<number | null>(null);
  const count = slides.length;
  const go = (d: number) => setIndex((i) => (i + d + count) % count);

  if (count === 0) {
    return (
      <div data-testid="product-gallery" className="mx-auto w-full max-w-[540px]">
        <ProductArt title={title} hex={hex} size="hero" />
      </div>
    );
  }
  const current = slides[Math.min(index, count - 1)];
  const arrow =
    "absolute top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/55 text-ink shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-2 focus-visible:outline-ink";

  return (
    <div className="mx-auto w-full max-w-[540px]" data-testid="product-gallery">
      <div
        className="relative aspect-[4/5] w-full overflow-hidden rounded-[6px] border border-neutral-200 bg-[#efe7da]"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null || count < 2) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        }}
        aria-roledescription="carousel"
        aria-label={`${title} pictures`}
      >
        <div aria-live="polite" className="absolute inset-0">
          {current.type === "photo" ? (
            <Image
              key={current.key}
              src={mediaUrl(current.src)}
              alt={current.alt}
              fill
              sizes="(min-width: 768px) 540px, 100vw"
              priority={index === 0}
              className="object-cover"
              data-testid="gallery-main"
            />
          ) : (
            <ArtSlide key={current.key} slide={current} brand={brand} />
          )}
        </div>
        {count > 1 ? (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`${arrow} left-4`}>
              <ChevronLeft aria-hidden className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`${arrow} right-4`}>
              <ChevronRight aria-hidden className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>
      {count > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-4 font-catalog text-[15px] text-ink">
          <span data-testid="gallery-position">
            {index + 1} / {count}
          </span>
          <div
            className="relative h-2.5 w-[236px] overflow-hidden rounded-full border border-ink"
            role="progressbar"
            aria-label="Picture"
            aria-valuemin={1}
            aria-valuemax={count}
            aria-valuenow={index + 1}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-ink transition-[left] duration-300"
              style={{ width: `${100 / count}%`, left: `${(index * 100) / count}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Colour views drawn from the garment silhouette, staged in an arched alcove. */
function ArtSlide({ slide, brand, compact = false }: { slide: Extract<Slide, { type: "art" }>; brand: string; compact?: boolean }) {
  return (
    <div role="img" aria-label={compact ? undefined : slide.alt} aria-hidden={compact || undefined} data-testid={compact ? undefined : "gallery-main"} className="absolute inset-0 overflow-hidden bg-gradient-to-b from-[#f1ebe1] to-[#e6dccb]">
      {/* arch */}
      <div className="absolute inset-x-[16%] top-[10%] bottom-[16%] rounded-t-full border-[6px] border-white/50 bg-[#ddd1bd] shadow-[inset_0_0_40px_rgba(0,0,0,0.06)]" />
      <div className="absolute inset-x-0 bottom-0 h-[16%] bg-[#f4efe6]" />
      {!compact ? (
        <>
          <span className="absolute left-[7%] top-[6%] font-display text-[15px] font-semibold tracking-[0.12em] text-espresso/70">{brand.toUpperCase()}</span>
          <span className="absolute right-[7%] top-[7%] text-[10px] font-semibold tracking-[0.3em] text-espresso/60">{slide.side === "front" ? "FRONT" : "BACK"}</span>
        </>
      ) : null}
      <div className="absolute inset-x-[22%] top-[15%]">
        <svg viewBox="0 0 200 44" aria-hidden className="relative -mb-[11%] block w-full">
          <path d="M100 20 V13 a7 7 0 1 1 7 -7" fill="none" stroke="#8d8d8d" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M100 18 L34 38 Q28 41 33 43 L167 43 Q172 41 166 38 Z" fill="#9a7048" />
        </svg>
        <GarmentArt kind={slide.kind} hex={slide.hex} side={slide.side} brand={brand} className="relative block w-full drop-shadow-[0_12px_14px_rgba(43,29,20,0.18)]" />
      </div>
    </div>
  );
}

function ColorThumb({ title, slide, hex }: { title: string; slide: Slide | undefined; hex: string | null }) {
  if (!slide) return <span className="block h-full w-full" style={{ backgroundColor: hex ?? "#ccc" }} />;
  if (slide.type === "photo") return <Image src={mediaUrl(slide.src)} alt="" fill sizes="100px" className="object-cover" />;
  return <ArtSlide slide={{ ...slide, alt: `${title} colour` }} brand="" compact />;
}

/* ---------------------------------------------------------------- buy panel */

function BuyPanel({
  variants,
  colors,
  color,
  onColor,
  swatch,
}: {
  variants: ViewVariant[];
  colors: [string, string | null][];
  color: string;
  onColor: (c: string) => void;
  swatch: (color: string, hex: string | null) => ReactNode;
}) {
  const router = useRouter();
  const [size, setSize] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const sizesForColor = variants.filter((v) => v.color === color).sort((a, b) => compareSizes(a.size, b.size));
  const selected = sizesForColor.find((v) => v.size === size) ?? null;
  const priceVariant = selected ?? sizesForColor[0] ?? variants[0];
  const off = discountLabel(priceVariant.price_minor, priceVariant.compare_at_minor);
  const soldOut = sizesForColor.every((v) => v.available <= 0);

  async function addToBag() {
    if (!selected) {
      setMessage({ tone: "error", text: "Please choose a size." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId: selected.id, quantity: 1, mode: "increment" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: body?.error?.message ?? "Could not add to bag." });
        return;
      }
      setMessage({ tone: "ok", text: `Added 1 × ${selected.size} / ${selected.color} to your bag.` });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="font-catalog">
      <p className="mt-5 flex flex-wrap items-baseline gap-x-2 text-[20px] font-semibold text-ink" data-testid="price">
        {formatBDTCode(priceVariant.price_minor)}
        {off ? (
          <>
            <s className="text-[15px] font-normal text-neutral-600">
              <span className="sr-only">Was </span>
              {formatBDTCode(priceVariant.compare_at_minor)}
            </s>
            <span className="text-[15px] font-normal text-danger">{off}</span>
          </>
        ) : null}
      </p>

      <fieldset className="mt-6">
        <legend className="text-[16px] text-ink">
          Color: <span className="text-neutral-600">{color}</span>
        </legend>
        <div className="mt-5 flex flex-wrap gap-5">
          {colors.map(([name, h]) => (
            <label key={name} className="cursor-pointer" title={name}>
              <input
                type="radio"
                name="color"
                value={name}
                checked={color === name}
                onChange={() => {
                  onColor(name);
                  setSize(null);
                  setMessage(null);
                }}
                className="peer sr-only"
              />
              <span className="relative block h-[124px] w-[99px] overflow-hidden border border-transparent outline-offset-2 peer-checked:border-ink peer-focus-visible:outline-2 peer-focus-visible:outline-ink">
                {swatch(name, h)}
              </span>
              <span className="sr-only">{name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-12">
        <legend className="flex w-full items-center justify-between text-[16px] text-ink">
          <span>
            Select Size{size ? <span className="sr-only">: {size}</span> : null}
          </span>
          <Link href="/size-guide" className="inline-flex items-center gap-3 underline underline-offset-4 hover:no-underline">
            Size Guide
            <Ruler aria-hidden className="h-5 w-5" strokeWidth={1.5} />
          </Link>
        </legend>
        <div className="mt-6 flex flex-wrap gap-x-3 gap-y-3">
          {sizesForColor.map((v) => {
            const out = v.available <= 0;
            return (
              <label key={v.id} className={out ? "cursor-not-allowed" : "cursor-pointer"}>
                <input
                  type="radio"
                  name="size"
                  value={v.size}
                  checked={size === v.size}
                  disabled={out}
                  onChange={() => {
                    setSize(v.size);
                    setMessage(null);
                  }}
                  className="peer sr-only"
                  aria-describedby={out ? `oos-${v.id}` : undefined}
                />
                <span
                  className={`inline-flex h-10 min-w-[62px] items-center justify-center rounded-full px-4 text-[15px] font-medium shadow-[0_2px_6px_rgba(0,0,0,0.08)] transition peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${out ? "bg-neutral-100 text-neutral-400 line-through" : "bg-white text-ink hover:bg-neutral-100"}`}
                >
                  {v.size}
                </span>
                {out ? (
                  <span id={`oos-${v.id}`} className="sr-only">
                    sold out
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
        <p className="mt-3 min-h-5 text-[13px] text-neutral-600" aria-live="polite" data-testid="availability">
          {selected
            ? selected.available > 5
              ? "In stock"
              : `Only ${selected.available} left`
            : soldOut
              ? "Sold out in this colour"
              : ""}
        </p>
      </fieldset>

      <button
        type="button"
        onClick={addToBag}
        disabled={busy || pending || soldOut}
        className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-[4px] bg-ink text-[16px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
      >
        <ShoppingBag aria-hidden className="h-5 w-5" />
        {busy || pending ? "Adding…" : soldOut ? "Out of stock" : "Add to bag"}
      </button>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 text-sm ${message.tone === "error" ? "text-danger" : "text-success"}`}>
          {message.text}{" "}
          {message.tone === "ok" ? (
            <Link href="/cart" className="underline">
              View bag
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ find in store */

function FindInStore({ title, code, store }: { title: string; code: string | null; store: StoreInfo }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const close = (e: MouseEvent) => {
      if (e.target === d) d.close();
    };
    d.addEventListener("click", close);
    return () => d.removeEventListener("click", close);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="mt-6 flex h-14 w-full items-center justify-center rounded-[4px] border border-ink bg-transparent font-catalog text-[16px] text-ink transition hover:bg-ink hover:text-white"
      >
        Find in store
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="find-in-store-title"
        className="m-auto w-[min(92vw,440px)] rounded-[6px] p-0 font-catalog text-ink shadow-xl backdrop:bg-black/40"
      >
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="find-in-store-title" className="text-[20px] font-medium">
              Find in store
            </h2>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="-m-2 rounded-full p-2 hover:bg-neutral-100">
              <X aria-hidden className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-2 text-[14px] text-neutral-600">
            Ask for <strong className="font-medium text-ink">{title}</strong>
            {code ? <> (code {code})</> : null} at the {store.name} store and we will hold your size for you to try on.
          </p>
          <div className="mt-5 flex gap-3 rounded-[4px] bg-neutral-100 p-4 text-[14px]">
            <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">{store.name}</p>
              {store.address ? <p className="mt-0.5 text-neutral-600">{store.address}</p> : <p className="mt-0.5 text-neutral-600">Store address coming soon.</p>}
              {store.hours ? <p className="mt-0.5 text-neutral-600">{store.hours}</p> : null}
              {store.phone ? (
                <p className="mt-2">
                  <a href={`tel:${store.phone}`} className="underline">
                    Call {store.phone}
                  </a>
                </p>
              ) : null}
            </div>
          </div>
          <Link href="/contact" className="mt-5 inline-block text-[14px] underline underline-offset-4">
            Contact us about stock
          </Link>
        </div>
      </dialog>
    </>
  );
}
