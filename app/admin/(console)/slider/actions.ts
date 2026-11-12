"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { flag, noAngle, str, type ActionState } from "@/lib/admin/action-state";
import { friendlyDbError } from "@/lib/db-errors";
import { PRODUCT_PHOTO_MESSAGES, prepareProductPhoto } from "@/lib/media/images";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const text = (max: number) => z.string().max(max).refine(noAngle, "No angle brackets");
const schema = z.object({
  title: z.string().min(1, "Title is required").max(80).refine(noAngle, "No angle brackets"),
  subtitle: text(160),
  eyebrow: text(40),
  image_alt: text(160),
  cta_label: text(30),
  link_url: z.union([z.literal(""), z.string().regex(/^\/[A-Za-z0-9/_.?=&%#-]{0,250}$|^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9/_.?=&%#-]{0,250})?$/, "Link: a path like /shop?sort=new or an https:// address")]),
  theme: z.enum(["dark", "light"]),
  position: z.coerce.number().int().min(0).max(999),
  starts_at: z.string(),
  ends_at: z.string(),
});

/** datetime-local (Dhaka time) → ISO, or null. */
function dhaka(local: string): string | null {
  if (!local) return null;
  const d = new Date(`${local}:00+06:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function saveSlide(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("cms.edit");
  if (!auth.ok) return { ok: false, message: auth.message };
  const keys = ["title", "subtitle", "eyebrow", "image_alt", "cta_label", "link_url", "theme", "position", "starts_at", "ends_at"] as const;
  const parsed = schema.safeParse(Object.fromEntries(keys.map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const d = parsed.data;
  const isActive = flag(fd, "is_active");
  if (isActive && !auth.staff.permissions.includes("cms.publish")) return { ok: false, message: "Showing a slide on the live store needs publish permission. Save it hidden and ask an editor with publish rights." };
  if ((d.link_url && !d.cta_label) || (!d.link_url && d.cta_label)) return { ok: false, message: "Give both a button label and a link, or neither." };
  const row: Record<string, unknown> = {
    title: d.title, subtitle: d.subtitle, eyebrow: d.eyebrow, image_alt: d.image_alt, cta_label: d.cta_label,
    link_url: d.link_url || null, theme: d.theme, position: d.position, is_active: isActive,
    starts_at: dhaka(d.starts_at), ends_at: dhaka(d.ends_at),
  };
  const supabase = await createSupabaseServerClient();
  const file = fd.get("image");
  let uploaded: string | null = null;
  if (file instanceof File && file.size > 0) {
    const prepared = await prepareProductPhoto(new Uint8Array(await file.arrayBuffer()));
    if (!prepared.ok) return { ok: false, message: PRODUCT_PHOTO_MESSAGES[prepared.code] };
    uploaded = `slides/${randomUUID()}.webp`;
    const { error } = await supabase.storage.from("site-media").upload(uploaded, Buffer.from(prepared.photo.bytes), { contentType: "image/webp", cacheControl: "31536000" });
    if (error) return { ok: false, message: "The image could not be stored. Please try again." };
    row.image_path = uploaded;
    if (!d.image_alt) return { ok: false, message: "Describe the image (alt text) for screen readers." };
  }
  if (!id && !uploaded) return { ok: false, message: "Choose a banner image (JPEG, PNG or WebP, at least 400 px)." };
  const { data: before } = id ? await supabase.from("home_slides").select("image_path").eq("id", id).maybeSingle() : { data: null };
  const { error } = id ? await supabase.from("home_slides").update(row).eq("id", id) : await supabase.from("home_slides").insert(row);
  if (error) {
    if (uploaded) await supabase.storage.from("site-media").remove([uploaded]);
    return { ok: false, message: friendlyDbError(error) };
  }
  if (uploaded && before?.image_path) await supabase.storage.from("site-media").remove([before.image_path as string]);
  revalidatePath("/admin/slider");
  revalidatePath("/");
  return { ok: true, message: id ? "Slide saved." : "Slide added." };
}

export async function deleteSlide(id: string): Promise<ActionState> {
  const auth = await checkStaff("cms.edit");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("home_slides").delete().eq("id", id).select("image_path").maybeSingle();
  if (data?.image_path) await supabase.storage.from("site-media").remove([data.image_path as string]);
  revalidatePath("/admin/slider");
  revalidatePath("/");
  return { ok: true, message: "Deleted." };
}
