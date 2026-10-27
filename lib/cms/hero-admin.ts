import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { heroSettingsSchema, parseScenes, type HeroScene, type HeroSettings } from "./hero";

export type DraftScene = HeroScene & { id: string; is_published: boolean };
export type HeroVersion = { id: string; version: number; note: string | null; created_at: string; scene_count: number };

/** Draft working copy for editors (RLS: cms.edit). */
export async function getDraftHero(key = "home") {
  const supabase = await createSupabaseServerClient();
  const { data: tour } = await supabase
    .from("hero_tours")
    .select("id, key, renderer, overlay_opacity, motion_strength, draft_settings, published_version_id")
    .eq("key", key)
    .maybeSingle();
  if (!tour) return null;
  const [{ data: rows }, { data: versions }] = await Promise.all([
    supabase
      .from("hero_scenes")
      .select("id, position, image_path, image_alt, eyebrow, heading, body, cta_label, cta_href, object_position, zoom, parallax, transition_ms, is_published")
      .eq("tour_id", tour.id)
      .order("position"),
    supabase
      .from("hero_tour_versions")
      .select("id, version, note, created_at, scenes")
      .eq("tour_id", tour.id)
      .order("version", { ascending: false })
      .limit(20),
  ]);
  const all = (rows ?? []) as (HeroScene & { id: string; is_published: boolean })[];
  const parsed = new Map(parseScenes(all).map((s) => [s.position, s]));
  const scenes: DraftScene[] = all
    .filter((r) => parsed.has(r.position))
    .map((r) => ({ ...parsed.get(r.position)!, id: r.id, is_published: r.is_published }));
  const settings: HeroSettings = heroSettingsSchema.parse(
    tour.draft_settings ?? { renderer: tour.renderer, overlay_opacity: tour.overlay_opacity, motion_strength: tour.motion_strength },
  );
  return {
    tourId: tour.id as string,
    liveVersionId: tour.published_version_id as string | null,
    scenes,
    settings,
    versions: ((versions ?? []) as { id: string; version: number; note: string | null; created_at: string; scenes: unknown[] }[]).map(
      (v) => ({ id: v.id, version: v.version, note: v.note, created_at: v.created_at, scene_count: v.scenes.length }),
    ) as HeroVersion[],
  };
}
