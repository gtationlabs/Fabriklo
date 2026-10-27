"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { HERO_IMAGES } from "@/lib/cms/hero-media";
import { friendlyDbError } from "@/lib/db-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Hero editor actions. Drafts need cms.edit; publish and rollback need
 * cms.publish. Postgres RLS / SECURITY DEFINER functions enforce the same.
 * Text is stored as plain text and rendered escaped: no HTML or scripts.
 */
export type HeroActionState = { ok: boolean; message: string | null; values?: Record<string, string> };

const pct = z.coerce.number().int().min(0).max(100);
const sceneForm = z.object({
  id: z.uuid(),
  image_path: z.enum(HERO_IMAGES.map((i) => i.path) as [string, ...string[]]),
  image_alt: z.string().trim().min(10, "Describe the image in at least 10 characters").max(300),
  eyebrow: z.string().trim().max(60),
  heading: z.string().trim().min(1, "Add a heading").max(90),
  body: z.string().trim().max(280),
  cta_label: z.string().trim().max(40),
  cta_href: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^\/([A-Za-z0-9_?=&.-][A-Za-z0-9/_?=&.-]{0,199})?$/.test(v), "Links must be internal paths such as /shop"),
  focus_x: pct,
  focus_y: pct,
  zoom: z.coerce.number().min(1).max(1.4),
  parallax: z.coerce.number().min(0).max(0.15),
  is_published: z.boolean(),
});

function echo(fd: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v.slice(0, 1000);
  return out;
}

export async function saveScene(_prev: HeroActionState, fd: FormData): Promise<HeroActionState> {
  const values = echo(fd);
  const parsed = sceneForm.safeParse({ ...values, is_published: fd.get("is_published") === "on" });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields.", values };
  const d = parsed.data;
  if ((d.cta_label === "") !== (d.cta_href === "")) {
    return { ok: false, message: "Give the button both a label and a link, or leave both empty.", values };
  }
  const auth = await checkStaff("cms.edit");
  if (!auth.ok) return { ok: false, message: auth.message, values };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("hero_scenes")
    .update({
      image_path: d.image_path,
      image_alt: d.image_alt,
      eyebrow: d.eyebrow,
      heading: d.heading,
      body: d.body,
      cta_label: d.cta_label || null,
      cta_href: d.cta_href || null,
      object_position: `${d.focus_x}% ${d.focus_y}%`,
      zoom: d.zoom,
      parallax: d.parallax,
      is_published: d.is_published,
    })
    .eq("id", d.id);
  if (error) return { ok: false, message: friendlyDbError(error), values };
  revalidatePath("/admin/content");
  return { ok: true, message: "Draft saved. Publish to make it live." };
}

export async function moveScene(fd: FormData) {
  const id = z.uuid().safeParse(fd.get("id"));
  const dir = Number(fd.get("direction"));
  if (!id.success || (dir !== 1 && dir !== -1)) return;
  const auth = await checkStaff("cms.edit");
  if (!auth.ok) return;
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("admin_move_hero_scene", { p_scene_id: id.data, p_direction: dir });
  revalidatePath("/admin/content");
}

const settingsForm = z.object({
  renderer: z.enum(["scroll-2.5d", "static"]),
  overlay: z.coerce.number().min(0).max(0.9),
  motion: z.coerce.number().min(0).max(1.5),
});

export async function saveSettings(_prev: HeroActionState, fd: FormData): Promise<HeroActionState> {
  const values = echo(fd);
  const parsed = settingsForm.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Check the tour settings.", values };
  const auth = await checkStaff("cms.edit");
  if (!auth.ok) return { ok: false, message: auth.message, values };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_hero_settings", {
    p_tour_key: "home",
    p_renderer: parsed.data.renderer,
    p_overlay: parsed.data.overlay,
    p_motion: parsed.data.motion,
  });
  if (error) return { ok: false, message: friendlyDbError(error), values };
  revalidatePath("/admin/content");
  return { ok: true, message: "Settings saved to the draft." };
}

export async function publishHero(_prev: HeroActionState, fd: FormData): Promise<HeroActionState> {
  const note = String(fd.get("note") ?? "").trim().slice(0, 200);
  const auth = await checkStaff("cms.publish");
  if (!auth.ok) return { ok: false, message: auth.message, values: { note } };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_publish_hero", { p_tour_key: "home", p_note: note || null });
  if (error) {
    const msg = error.hint === "no_scenes" ? "Make at least one scene visible before publishing." : friendlyDbError(error);
    return { ok: false, message: msg, values: { note } };
  }
  revalidatePath("/admin/content");
  revalidatePath("/");
  return { ok: true, message: `Published version ${(data as { version: number }).version}. It is live on the home page.` };
}

export async function rollbackHero(_prev: HeroActionState, fd: FormData): Promise<HeroActionState> {
  const id = z.uuid().safeParse(fd.get("versionId"));
  if (!id.success) return { ok: false, message: "Unknown version." };
  const auth = await checkStaff("cms.publish");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_rollback_hero", { p_version_id: id.data });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/content");
  revalidatePath("/");
  return { ok: true, message: `Version ${(data as { version: number }).version} is live again and loaded as the draft.` };
}
