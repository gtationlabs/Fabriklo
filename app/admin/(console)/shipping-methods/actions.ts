"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { flag, noAngle, str, type ActionState } from "@/lib/admin/action-state";
import { friendlyDbError } from "@/lib/db-errors";
import { parseTakaToMinor } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const days = z.union([z.literal(""), z.coerce.number().int().min(0).max(60)]);
const schema = z.object({
  code: z.string().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/, "Code: 2 to 40 lower-case letters, digits, - or _"),
  name: z.string().min(2, "Name must be 2 to 60 characters").max(60).refine(noAngle, "No angle brackets"),
  description: z.string().max(200).refine(noAngle, "No angle brackets"),
  fee_taka: z.string(),
  estimate_min_days: days,
  estimate_max_days: days,
  position: z.coerce.number().int().min(0).max(999),
});

export async function saveMethod(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("settings.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const keys = ["code", "name", "description", "fee_taka", "estimate_min_days", "estimate_max_days", "position"] as const;
  const parsed = schema.safeParse(Object.fromEntries(keys.map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const d = parsed.data;
  const fee = parseTakaToMinor(d.fee_taka || "0");
  if (fee === null || fee < 0 || fee > 10000000) return { ok: false, message: "Enter the extra charge in taka (0 to 100,000)." };
  const min = d.estimate_min_days === "" ? null : d.estimate_min_days;
  const max = d.estimate_max_days === "" ? null : d.estimate_max_days;
  if (min !== null && max !== null && max < min) return { ok: false, message: "The maximum estimate must be at least the minimum." };
  const isActive = flag(fd, "is_active");
  const isDefault = flag(fd, "is_default");
  if (isDefault && !isActive) return { ok: false, message: "The default option must be active." };
  const supabase = await createSupabaseServerClient();
  if (isDefault) {
    // Only one default: clear the others first (each change is audited).
    const clear = supabase.from("shipping_methods").update({ is_default: false }).eq("is_default", true);
    const { error } = id ? await clear.neq("id", id) : await clear;
    if (error) return { ok: false, message: friendlyDbError(error) };
  }
  const row = { code: d.code, name: d.name, description: d.description, fee_adjust_minor: fee, estimate_min_days: min, estimate_max_days: max, position: d.position, cod_allowed: flag(fd, "cod_allowed"), is_active: isActive, is_default: isDefault };
  const { error } = id ? await supabase.from("shipping_methods").update(row).eq("id", id) : await supabase.from("shipping_methods").insert(row);
  if (error) return { ok: false, message: error.code === "23505" ? "That code is already used." : friendlyDbError(error) };
  const { count } = await supabase.from("shipping_methods").select("id", { count: "exact", head: true }).eq("is_default", true);
  revalidatePath("/admin/shipping-methods");
  revalidatePath("/checkout");
  return { ok: true, message: count ? "Delivery option saved." : "Saved. Note: no option is marked as default, so carts without a choice pay the zone fee only." };
}
