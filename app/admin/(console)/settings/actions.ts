"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { friendlyDbError } from "@/lib/db-errors";
import { BD_DISTRICTS } from "@/lib/geo/bd";
import { parseTakaToMinor } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Store settings (settings.manage). Non-secret values only; each key is
 * validated here AND in private.validate_site_setting, and every change is
 * audited. Rates and limits are stored in integer minor units (poisha).
 */
export type SettingsActionState = { ok: boolean; message: string | null; values?: Record<string, string> };

function echo(fd: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v.slice(0, 300);
  return out;
}

async function updateSetting(key: string, value: unknown, paths: string[] = []): Promise<SettingsActionState> {
  const auth = await checkStaff("settings.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_site_setting", { p_key: key, p_value: value });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/settings");
  for (const p of paths) revalidatePath(p, "layout");
  return { ok: true, message: "Saved." };
}

const noAngle = (s: string) => !/[<>]/.test(s);

export async function saveIdentity(_prev: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = echo(fd);
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Store name must be 2 to 60 characters").max(60).refine(noAngle, "No angle brackets"),
      tagline: z.string().trim().max(120).refine(noAngle, "No angle brackets"),
      locale: z.enum(["en-BD", "bn-BD"]),
    })
    .safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields.", values };
  const r = await updateSetting("store.identity", { ...parsed.data, currency: "BDT" }, ["/"]);
  return r.ok ? { ...r, message: "Store identity saved. The storefront shows the new name immediately." } : { ...r, values };
}

export async function saveContact(_prev: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = echo(fd);
  const parsed = z
    .object({
      email: z.email("Enter a valid contact email").max(120),
      phone: z.string().trim().regex(/^\+8801[3-9][0-9]{8}$/, "Phone must look like +8801XXXXXXXXX"),
      address: z.string().trim().max(200).refine(noAngle, "No angle brackets"),
      hours: z.string().trim().max(120).refine(noAngle, "No angle brackets"),
      note: z.string().trim().max(200).refine(noAngle, "No angle brackets"),
    })
    .safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields.", values };
  const r = await updateSetting("store.contact", parsed.data, ["/"]);
  return r.ok ? r : { ...r, values };
}

export async function saveCod(_prev: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = echo(fd);
  const max = parseTakaToMinor(String(fd.get("max_order_taka") ?? ""));
  if (max === null || max < 10000 || max > 100000000) return { ok: false, message: "The cash on delivery limit must be between ৳100 and ৳1,000,000.", values };
  const r = await updateSetting("checkout.cod", { enabled: fd.get("enabled") === "on", max_order_minor: max });
  return r.ok ? { ...r, message: "Cash on delivery settings saved. New checkouts use them immediately." } : { ...r, values };
}

export async function saveOnline(_prev: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = echo(fd);
  const hold = z.coerce.number().int().min(5).max(120).safeParse(fd.get("hold_minutes"));
  if (!hold.success) return { ok: false, message: "Stock hold must be between 5 and 120 minutes.", values };
  const r = await updateSetting("checkout.online", { enabled: fd.get("enabled") === "on", hold_minutes: hold.data });
  return r.ok ? r : { ...r, values };
}

export async function confirmRates(_prev: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const confirmed = fd.get("rates_confirmed") === "on";
  const r = await updateSetting("store.setup", { rates_confirmed: confirmed }, ["/checkout"]);
  return r.ok ? { ...r, message: confirmed ? "Marked as real rates. The demo warning is gone." : "Marked as demo rates." } : r;
}

const zoneSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).default(""),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/, "Code: 2 to 40 lower-case letters, digits, - or _"),
  name: z.string().trim().min(2, "Name must be 2 to 80 characters").max(80).refine(noAngle, "No angle brackets"),
  fee_taka: z.string(),
  free_over_taka: z.string().default(""),
  estimate_min_days: z.coerce.number().int().min(0).max(60),
  estimate_max_days: z.coerce.number().int().min(0).max(60),
  cod_enabled: z.boolean(),
  is_fallback: z.boolean(),
  is_active: z.boolean(),
  districts: z.array(z.enum(BD_DISTRICTS as [string, ...string[]])).max(64),
});

export async function saveZone(_prev: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = echo(fd);
  const parsed = zoneSchema.safeParse({
    ...values,
    cod_enabled: fd.get("cod_enabled") === "on",
    is_fallback: fd.get("is_fallback") === "on",
    is_active: fd.get("is_active") === "on",
    districts: fd.getAll("districts").filter((d): d is string => typeof d === "string"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields.", values };
  const d = parsed.data;
  const fee = parseTakaToMinor(d.fee_taka);
  if (fee === null || fee < 0 || fee > 10000000) return { ok: false, message: "Enter the delivery fee in taka (0 to 100,000).", values };
  const freeOver = d.free_over_taka.trim() ? parseTakaToMinor(d.free_over_taka) : null;
  if (d.free_over_taka.trim() && (freeOver === null || freeOver <= 0)) return { ok: false, message: "Free delivery threshold must be a positive amount, or empty.", values };
  if (d.estimate_max_days < d.estimate_min_days) return { ok: false, message: "The maximum delivery estimate must be at least the minimum.", values };
  const auth = await checkStaff("settings.manage");
  if (!auth.ok) return { ok: false, message: auth.message, values };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_save_shipping_zone", {
    p: {
      id: d.id || null,
      code: d.code,
      name: d.name,
      districts: d.districts,
      is_fallback: d.is_fallback,
      fee_minor: fee,
      free_over_minor: freeOver,
      cod_enabled: d.cod_enabled,
      estimate_min_days: d.estimate_min_days,
      estimate_max_days: d.estimate_max_days,
      is_active: d.is_active,
    },
  });
  if (error) return { ok: false, message: friendlyDbError(error), values };
  revalidatePath("/admin/settings");
  revalidatePath("/checkout");
  return { ok: true, message: d.id ? "Zone saved. New checkout quotes use it immediately." : "Zone created." };
}
