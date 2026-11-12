"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff, getStaffState } from "@/lib/auth/staff";
import { flag, noAngle, str, type ActionState } from "@/lib/admin/action-state";
import { friendlyDbError } from "@/lib/db-errors";
import { normalizeBdPhone } from "@/lib/geo/bd";
import { PRODUCT_PHOTO_MESSAGES, prepareAvatar } from "@/lib/media/images";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function staffOnly() {
  const s = await getStaffState();
  return s.kind === "ok" ? s.staff : null;
}

// ---------------------------------------------------------------- profile
const profileSchema = z.object({
  display_name: z.string().min(2, "Display name must be 2 to 60 characters").max(60).refine(noAngle, "No angle brackets"),
  full_name: z.string().max(120).refine(noAngle, "No angle brackets"),
  job_title: z.string().max(80).refine(noAngle, "No angle brackets"),
  phone: z.string().max(20),
  language: z.enum(["en", "bn"]),
});

export async function saveProfile(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await staffOnly();
  if (!staff) return { ok: false, message: "Your session has expired. Sign in again." };
  const keys = ["display_name", "full_name", "job_title", "phone", "language"] as const;
  const parsed = profileSchema.safeParse(Object.fromEntries(keys.map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const phone = parsed.data.phone ? normalizeBdPhone(parsed.data.phone) : "";
  if (phone === null) return { ok: false, message: "Phone must be a Bangladesh mobile number." };
  const supabase = await createSupabaseServerClient();
  const payload: Record<string, unknown> = { ...parsed.data, phone, show_on_invoices: flag(fd, "show_on_invoices") };

  let uploaded: string | null = null;
  const file = fd.get("avatar");
  if (file instanceof File && file.size > 0) {
    const prepared = await prepareAvatar(new Uint8Array(await file.arrayBuffer()));
    if (!prepared.ok) return { ok: false, message: PRODUCT_PHOTO_MESSAGES[prepared.code].replace("400 pixels", "64 pixels") };
    uploaded = `avatars/${staff.userId}/${randomUUID()}.webp`;
    const { error } = await supabase.storage.from("site-media").upload(uploaded, Buffer.from(prepared.bytes), { contentType: "image/webp", cacheControl: "31536000" });
    if (error) return { ok: false, message: "The photo could not be stored. Please try again." };
    payload.avatar_path = uploaded;
  } else if (flag(fd, "remove_avatar")) {
    payload.avatar_path = "";
  }
  const { data: before } = await supabase.from("staff_profiles").select("avatar_path").eq("user_id", staff.userId).maybeSingle();
  const { error } = await supabase.rpc("staff_save_my_profile", { p: payload });
  if (error) {
    if (uploaded) await supabase.storage.from("site-media").remove([uploaded]);
    return { ok: false, message: friendlyDbError(error) };
  }
  if ("avatar_path" in payload && before?.avatar_path) await supabase.storage.from("site-media").remove([before.avatar_path as string]);
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Profile saved." };
}

// ---------------------------------------------------------------- account
export async function changePassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await staffOnly();
  if (!staff) return { ok: false, message: "Your session has expired. Sign in again." };
  const pw = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (pw.length < 12 || pw.length > 128) return { ok: false, message: "Use 12 to 128 characters." };
  if (pw !== confirm) return { ok: false, message: "The two passwords do not match." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { ok: false, message: /same|different/i.test(error.message) ? "Choose a password you have not used here before." : /weak|pwned|leak/i.test(error.message) ? "That password is too weak or appears in known leaks." : "The password could not be changed. Please try again." };
  await supabase.rpc("staff_record_own_security_event", { p_action: "staff.password_change" });
  return { ok: true, message: "Password changed." };
}

export async function signOutOtherSessions(): Promise<ActionState> {
  const staff = await staffOnly();
  if (!staff) return { ok: false, message: "Your session has expired. Sign in again." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { ok: false, message: "Could not sign out the other sessions. Please try again." };
  await supabase.rpc("staff_record_own_security_event", { p_action: "staff.sign_out_others" });
  return { ok: true, message: "Every other device has been signed out." };
}

// ---------------------------------------------------------------- store settings (settings.manage)
async function updateSetting(key: string, value: unknown, paths: string[] = []): Promise<ActionState> {
  const auth = await checkStaff("settings.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_site_setting", { p_key: key, p_value: value });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  for (const p of paths) revalidatePath(p, "layout");
  return { ok: true, message: "Saved." };
}

const invoiceSchema = z.object({
  legal_name: z.string().max(120).refine(noAngle, "No angle brackets"),
  bin: z.string().regex(/^([0-9]{9,13})?$/, "BIN must be 9 to 13 digits"),
  header_note: z.string().max(200).refine(noAngle, "No angle brackets"),
  footer_note: z.string().max(300).refine(noAngle, "No angle brackets"),
  return_policy: z.string().max(600).refine(noAngle, "No angle brackets"),
});

export async function saveInvoiceSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const keys = ["legal_name", "bin", "header_note", "footer_note", "return_policy"] as const;
  const parsed = invoiceSchema.safeParse(Object.fromEntries(keys.map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const r = await updateSetting("store.invoice", { ...parsed.data, show_sku: flag(fd, "show_sku"), packing_slip_prices: flag(fd, "packing_slip_prices") });
  return r.ok ? { ...r, message: "Invoice settings saved. New prints use them." } : r;
}

const socialUrl = (host: RegExp) => z.union([z.literal(""), z.string().max(240).url("Use a full https:// link").refine((u) => u.startsWith("https://") && host.test(new URL(u).hostname), "That link is not on the right site")]);
const socialSchema = z.object({
  facebook: socialUrl(/(^|\.)(facebook\.com|fb\.com)$/),
  instagram: socialUrl(/(^|\.)instagram\.com$/),
  tiktok: socialUrl(/(^|\.)tiktok\.com$/),
  youtube: socialUrl(/(^|\.)(youtube\.com|youtu\.be)$/),
  whatsapp: z.string().max(20),
});

export async function saveSocial(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const keys = ["facebook", "instagram", "tiktok", "youtube", "whatsapp"] as const;
  const parsed = socialSchema.safeParse(Object.fromEntries(keys.map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the links." };
  const wa = parsed.data.whatsapp ? normalizeBdPhone(parsed.data.whatsapp) : "";
  if (wa === null) return { ok: false, message: "WhatsApp must be a Bangladesh mobile number." };
  const r = await updateSetting("store.social", { ...parsed.data, whatsapp: wa }, ["/"]);
  return r.ok ? { ...r, message: "Social profiles saved. They show in the shop footer." } : r;
}

// ---------------------------------------------------------------- Meta pixels (integrations.manage)
export async function savePixel(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("integrations.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = z.object({
    pixel_id: z.string().regex(/^[0-9]{8,20}$/, "Pixel / dataset id: 8 to 20 digits from Meta Events Manager"),
    name: z.string().min(2, "Name: 2 to 60 characters").max(60).refine(noAngle, "No angle brackets"),
    notes: z.string().max(300).refine(noAngle, "No angle brackets"),
  }).safeParse({ pixel_id: str(fd, "pixel_id"), name: str(fd, "name"), notes: str(fd, "notes") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const supabase = await createSupabaseServerClient();
  const row = { ...parsed.data, is_active: flag(fd, "is_active") };
  const { error } = id ? await supabase.from("meta_pixels").update(row).eq("id", id) : await supabase.from("meta_pixels").insert(row);
  if (error) return { ok: false, message: error.code === "23505" ? "That pixel is already added." : friendlyDbError(error) };
  revalidatePath("/admin/settings/meta-pixels");
  revalidatePath("/", "layout");
  return { ok: true, message: "Pixel saved." };
}

export async function deletePixel(id: string): Promise<ActionState> {
  const auth = await checkStaff("integrations.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("meta_pixels").delete().eq("id", id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/settings/meta-pixels");
  revalidatePath("/", "layout");
  return { ok: true, message: "Removed." };
}

// ---------------------------------------------------------------- API keys (integrations.manage)
const SCOPES = ["products.read", "orders.read", "inventory.read"] as const;

export async function createApiKey(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("integrations.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const name = str(fd, "name");
  if (name.length < 2 || name.length > 60 || /[<>]/.test(name)) return { ok: false, message: "Name the key (2 to 60 characters), e.g. “Accounting export”." };
  const scopes = SCOPES.filter((s) => fd.get(`scope_${s}`) === "on");
  if (!scopes.length) return { ok: false, message: "Choose at least one permission for the key." };
  const days = Number(str(fd, "expires_days") || "0");
  const expires = days > 0 ? new Date(Date.now() + Math.min(days, 730) * 86_400_000).toISOString() : null;
  const secret = `fbk_${randomBytes(4).toString("hex")}_${randomBytes(24).toString("base64url")}`;
  const prefix = secret.slice(0, 12);
  const hash = createHash("sha256").update(secret).digest("hex");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("api_keys").insert({ name, prefix, key_hash: hash, scopes, expires_at: expires });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/settings/api");
  return { ok: true, message: "Key created.", secret };
}

export async function revokeApiKey(id: string): Promise<ActionState> {
  const auth = await checkStaff("integrations.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/settings/api");
  return { ok: true, message: "Key revoked. Requests with it now fail." };
}

// ---------------------------------------------------------------- staff MFA switch (super admin)
export async function setStaffMfaRequired(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await staffOnly();
  if (!staff) return { ok: false, message: "Your session has expired. Sign in again." };
  if (staff.role !== "super_admin") return { ok: false, message: "Only a super admin can change this." };
  const required = str(fd, "required") === "on";
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_staff_mfa_required", { p_required: required });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  return {
    ok: true,
    message: required
      ? "Authenticator codes are now required. Staff without one are asked to set it up."
      : "Authenticator codes are now off. Staff sign in with email and password only.",
  };
}
