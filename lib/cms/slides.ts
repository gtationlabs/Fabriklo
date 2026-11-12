import "server-only";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { siteMediaUrl } from "@/lib/media/url";

export type HomeSlide = { id: string; title: string; subtitle: string; eyebrow: string; image: string; alt: string; href: string | null; cta: string; theme: "dark" | "light" };

/** Slides that are switched on and inside their schedule (RLS filters the rest). */
export async function getLiveSlides(): Promise<HomeSlide[]> {
  try {
    const { data, error } = await createSupabasePublicClient()
      .from("home_slides")
      .select("id, title, subtitle, eyebrow, image_path, image_alt, link_url, cta_label, theme")
      .order("position")
      .order("created_at")
      .limit(8);
    if (error || !data) return [];
    return (data as { id: string; title: string; subtitle: string; eyebrow: string; image_path: string | null; image_alt: string; link_url: string | null; cta_label: string; theme: "dark" | "light" }[])
      .filter((s) => s.image_path)
      .map((s) => ({ id: s.id, title: s.title, subtitle: s.subtitle, eyebrow: s.eyebrow, image: siteMediaUrl(s.image_path!), alt: s.image_alt, href: s.link_url, cta: s.cta_label, theme: s.theme }));
  } catch {
    return [];
  }
}
