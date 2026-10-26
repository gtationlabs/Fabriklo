import "server-only";
import { z } from "zod";
import { createSupabasePublicClient } from "@/lib/supabase/public";

/** Typed, bounded hero-scene schema (mirrors CHECK constraints in SQL). */
export const heroSceneSchema = z.object({
  position: z.number().int().min(1).max(12),
  image_path: z.string().regex(/^\/assets\/store\/[a-z0-9_-]+\.(webp|jpg|png|avif)$/),
  image_alt: z.string().min(10).max(300),
  eyebrow: z.string().max(60),
  heading: z.string().min(1).max(90),
  body: z.string().max(280),
  cta_label: z.string().min(2).max(40).nullable(),
  cta_href: z.string().regex(/^\/[A-Za-z0-9/_?=&.-]{0,200}$/).nullable(),
  object_position: z.string().regex(/^(100|[1-9]?[0-9])% (100|[1-9]?[0-9])%$/),
  zoom: z.coerce.number().min(1).max(1.4),
  parallax: z.coerce.number().min(0).max(0.15),
  transition_ms: z.number().int().min(200).max(3000),
});
export type HeroScene = z.infer<typeof heroSceneSchema>;

/** Built-in fallback so the homepage still renders if the CMS is unreachable. */
export const FALLBACK_SCENES: HeroScene[] = [
  {
    position: 1,
    image_path: "/assets/store/store-01.webp",
    image_alt: "Wide view of the store entrance with wooden ceiling, clothing racks and the checkout counter.",
    eyebrow: "Welcome in",
    heading: "Step inside the store",
    body: "Scroll to walk through the showroom, or skip straight to the collection.",
    cta_label: "Explore the collection",
    cta_href: "/shop",
    object_position: "50% 55%",
    zoom: 1.06,
    parallax: 0.04,
    transition_ms: 900,
  },
];

export async function getPublishedHeroScenes(): Promise<HeroScene[]> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("hero_scenes")
    .select("position, image_path, image_alt, eyebrow, heading, body, cta_label, cta_href, object_position, zoom, parallax, transition_ms, hero_tours!inner(key)")
    .eq("hero_tours.key", "home")
    .order("position");
  if (error || !data?.length) return FALLBACK_SCENES;
  const parsed = data.map((row) => heroSceneSchema.safeParse(row)).filter((r) => r.success).map((r) => r.data);
  return parsed.length ? parsed : FALLBACK_SCENES;
}

/** Responsive sources generated for each render (see docs/3D_TOUR_ASSETS.md). */
export function heroSrcSet(path: string): string {
  const base = path.replace(/\.(webp|jpg|png|avif)$/, "");
  return `${base}-768.webp 768w, ${base}-1280.webp 1280w, ${path} 1728w`;
}
