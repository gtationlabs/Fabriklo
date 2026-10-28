import "server-only";
import { z } from "zod";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { FALLBACK_SCENES } from "./hero-fallback";

/** Typed, bounded hero-scene schema (mirrors CHECK constraints in SQL). */
export const heroSceneSchema = z.object({
  position: z.number().int().min(1).max(12),
  image_path: z.string().regex(/^\/assets\/store\/[a-z0-9_-]+\.(webp|jpg|png|avif)$/),
  image_alt: z.string().min(10).max(300),
  eyebrow: z.string().max(60),
  heading: z.string().min(1).max(90),
  body: z.string().max(280),
  cta_label: z.string().min(2).max(40).nullable(),
  cta_href: z.string().regex(/^\/([A-Za-z0-9_?=&.-][A-Za-z0-9/_?=&.-]{0,199})?$/).nullable(),
  object_position: z.string().regex(/^(100|[1-9]?[0-9])% (100|[1-9]?[0-9])%$/),
  zoom: z.coerce.number().min(1).max(1.4),
  parallax: z.coerce.number().min(0).max(0.15),
  transition_ms: z.number().int().min(200).max(3000),
});
export type HeroScene = z.infer<typeof heroSceneSchema>;

export { FALLBACK_SCENES };

export const heroSettingsSchema = z.object({
  renderer: z.enum(["scroll-2.5d", "static", "gltf"]).catch("scroll-2.5d"),
  overlay_opacity: z.coerce.number().min(0).max(0.9).catch(0.35),
  motion_strength: z.coerce.number().min(0).max(1.5).catch(1),
});
export type HeroSettings = z.infer<typeof heroSettingsSchema>;
export const DEFAULT_HERO_SETTINGS: HeroSettings = { renderer: "scroll-2.5d", overlay_opacity: 0.35, motion_strength: 1 };

export type HeroTour = { scenes: HeroScene[]; settings: HeroSettings };

function parseScenes(rows: unknown[]): HeroScene[] {
  return rows
    .map((row) => heroSceneSchema.safeParse(row))
    .filter((r) => r.success)
    .map((r) => r.data)
    .sort((a, b) => a.position - b.position);
}

/**
 * The LIVE tour: the published, immutable snapshot (RLS only exposes the
 * version a tour currently points at). Drafts never reach the storefront.
 */
export async function getPublishedHero(key = "home"): Promise<HeroTour> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("hero_tour_versions")
    .select("scenes, settings, tour:hero_tours!hero_tour_versions_tour_id_fkey!inner(key)")
    .eq("tour.key", key)
    .limit(1)
    .maybeSingle();
  if (error || !data) return { scenes: FALLBACK_SCENES, settings: DEFAULT_HERO_SETTINGS };
  const scenes = parseScenes((data.scenes as unknown[]) ?? []);
  return {
    scenes: scenes.length ? scenes : FALLBACK_SCENES,
    settings: heroSettingsSchema.parse(data.settings ?? {}),
  };
}

export { parseScenes };
export { heroSrcSet } from "./hero-media";
