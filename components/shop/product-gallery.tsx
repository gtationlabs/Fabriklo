"use client";

import Image from "next/image";
import { useState } from "react";
import { mediaUrl } from "@/lib/media/url";
import { ProductArt } from "./product-art";

export type GalleryImage = { id: string; src: string; alt: string; width: number | null; height: number | null; color: string | null };

/**
 * Product page gallery: large image with thumbnails. Falls back to the
 * labelled placeholder when the product has no photos yet.
 */
export function ProductGallery({ title, hex, images }: { title: string; hex: string | null | undefined; images: GalleryImage[] }) {
  const [current, setCurrent] = useState(0);
  if (images.length === 0) return <ProductArt title={title} hex={hex} size="hero" />;
  const main = images[Math.min(current, images.length - 1)];
  return (
    <div className="grid gap-3" data-testid="product-gallery">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded bg-sand">
        <Image
          key={main.id}
          src={mediaUrl(main.src)}
          alt={main.alt}
          fill
          sizes="(min-width: 768px) 50vw, 100vw"
          priority={current === 0}
          className="object-cover"
          data-testid="gallery-main"
        />
      </div>
      {images.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto" aria-label="More photos">
          {images.map((img, i) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setCurrent(i)}
                aria-pressed={i === current}
                aria-label={`Show photo ${i + 1}${img.color ? ` (${img.color})` : ""}`}
                className={`relative block h-20 w-16 overflow-hidden rounded border ${i === current ? "border-espresso" : "border-line"}`}
              >
                <Image src={mediaUrl(img.src)} alt="" fill sizes="64px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
