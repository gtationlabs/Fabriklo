/** Responsive sources generated for each render (see docs/3D_TOUR_ASSETS.md). */
export function heroSrcSet(path: string): string {
  const base = path.replace(/\.(webp|jpg|png|avif)$/, "");
  return `${base}-768.webp 768w, ${base}-1280.webp 1280w, ${path} 1728w`;
}

/** Tiny blurred placeholder generated next to each render. */
export function heroBlur(path: string): string {
  return path.replace(/\.(webp|jpg|png|avif)$/, "-blur.webp");
}

/** The owner's five store renders, in walkthrough order (verified, docs/3D_TOUR_ASSETS.md). */
export const HERO_IMAGES = [
  { path: "/assets/store/store-01.webp", label: "1 · Entrance" },
  { path: "/assets/store/store-02.webp", label: "2 · Left shelving (tops)" },
  { path: "/assets/store/store-03.webp", label: "3 · Right racks (trousers)" },
  { path: "/assets/store/store-04.webp", label: "4 · Checkout counter" },
  { path: "/assets/store/store-05.webp", label: "5 · Fitting rooms" },
] as const;
