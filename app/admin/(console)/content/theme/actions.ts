"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { friendlyDbError } from "@/lib/db-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BODY_FONTS, COLOR_KEYS, DISPLAY_FONTS, RADII, normaliseHex, themeTokensSchema } from "@/lib/theme/tokens";

/**
 * Theme editor actions. Draft edits need cms.edit; publish and rollback need
 * theme.publish. SQL re-validates the token set and enforces the same permissions.
 */
export type ThemeActionState = { ok: boolean; message: string | null };

export async function saveThemeDraft(_prev: ThemeActionState, fd: FormData): Promise<ThemeActionState> {
  const colors: Record<string, string> = {};
  for (const k of COLOR_KEYS) colors[k] = normaliseHex(String(fd.get(`color_${k}`) ?? ""));
  const candidate = {
    colors,
    fonts: { display: String(fd.get("font_display") ?? ""), body: String(fd.get("font_body") ?? "") },
    radius: String(fd.get("radius") ?? ""),
  };
  const parsed = themeTokensSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `${issue?.path.join(".") ?? "theme"}: ${issue?.message ?? "invalid"}` };
  }
  if (!(parsed.data.fonts.display in DISPLAY_FONTS) || !(parsed.data.fonts.body in BODY_FONTS) || !(parsed.data.radius in RADII)) {
    return { ok: false, message: "Unknown font or radius." };
  }
  const auth = await checkStaff("cms.edit");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_save_theme_draft", { p_tokens: parsed.data });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/content/theme");
  return { ok: true, message: "Draft saved. Preview it, then publish to change the live store." };
}

export async function publishTheme(_prev: ThemeActionState, fd: FormData): Promise<ThemeActionState> {
  const note = z.string().trim().max(200).safeParse(fd.get("note") ?? "");
  if (!note.success) return { ok: false, message: "Keep the note under 200 characters." };
  const auth = await checkStaff("theme.publish");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_publish_theme", { p_note: note.data || null });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/", "layout");
  revalidatePath("/admin/content/theme");
  const v = (data as { version?: number } | null)?.version;
  return { ok: true, message: `Published version ${v ?? ""}. The storefront now uses it.` };
}

export async function rollbackTheme(_prev: ThemeActionState, fd: FormData): Promise<ThemeActionState> {
  const id = z.uuid().safeParse(fd.get("versionId"));
  if (!id.success) return { ok: false, message: "Pick a version." };
  const auth = await checkStaff("theme.publish");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_rollback_theme", { p_version_id: id.data });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/", "layout");
  revalidatePath("/admin/content/theme");
  const v = (data as { version?: number } | null)?.version;
  return { ok: true, message: `Version ${v ?? ""} is live again and loaded as the draft.` };
}
