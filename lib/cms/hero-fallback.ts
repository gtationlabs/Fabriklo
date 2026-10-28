import type { HeroScene } from "./hero";

const DEFAULT_SCENE_TIMING = { transition_ms: 900 } as const;

/**
 * Built-in five-scene tour (same content as supabase/seed.sql). Used whenever
 * no version has been published yet (a fresh production database has no seed),
 * or the CMS is unreachable, so the home page always gets the full walkthrough
 * instead of a single static picture.
 */
export const FALLBACK_SCENES: HeroScene[] = [
  {
    position: 1,
    image_path: "/assets/store/store-01.webp",
    image_alt: "Wide view of the store entrance: warm wooden ceiling, track lights, clothing racks on both sides and the checkout counter at the back.",
    eyebrow: "Welcome in",
    heading: "Step inside the store",
    body: "Scroll to walk through the showroom, or skip straight to the collection.",
    cta_label: "Explore the collection",
    cta_href: "/shop",
    object_position: "50% 55%",
    zoom: 1.06,
    parallax: 0.04,
    ...DEFAULT_SCENE_TIMING,
  },
  {
    position: 2,
    image_path: "/assets/store/store-02.webp",
    image_alt: "Left wall shelving with folded tees and hanging tops above a low display table, with fitting rooms in the background.",
    eyebrow: "Tops and tees",
    heading: "Everyday layers, folded and ready",
    body: "Soft cotton tees, knits and shirts in warm, easy colours.",
    cta_label: "Shop T-shirts",
    cta_href: "/category/t-shirts",
    object_position: "40% 50%",
    zoom: 1.08,
    parallax: 0.05,
    ...DEFAULT_SCENE_TIMING,
  },
  {
    position: 3,
    image_path: "/assets/store/store-03.webp",
    image_alt: "Right side racks with tailored trousers on a chrome rail and shirts on a wooden wall unit.",
    eyebrow: "Trousers and shirts",
    heading: "Tailoring that moves with you",
    body: "Chinos, herringbone trousers and checked shirts for work and weekend.",
    cta_label: "Shop pants",
    cta_href: "/category/pants",
    object_position: "55% 55%",
    zoom: 1.08,
    parallax: 0.05,
    ...DEFAULT_SCENE_TIMING,
  },
  {
    position: 4,
    image_path: "/assets/store/store-04.webp",
    image_alt: "The main checkout counter with three numbered service points and lettered wall art behind it.",
    eyebrow: "Checkout",
    heading: "Easy checkout, cash on delivery",
    body: "Pay cash on delivery and follow your order from packing to doorstep.",
    cta_label: "How delivery works",
    cta_href: "/shipping",
    object_position: "55% 50%",
    zoom: 1.06,
    parallax: 0.03,
    ...DEFAULT_SCENE_TIMING,
  },
  {
    position: 5,
    image_path: "/assets/store/store-05.webp",
    image_alt: "Fitting rooms for women and men next to a rack of jackets, beside the service counter.",
    eyebrow: "Fitting rooms",
    heading: "Try it on, even from home",
    body: "Preview selected pieces on your own photo with AI try-on (coming soon).",
    cta_label: "Start shopping",
    cta_href: "/shop",
    object_position: "45% 50%",
    zoom: 1.07,
    parallax: 0.04,
    ...DEFAULT_SCENE_TIMING,
  },
];
