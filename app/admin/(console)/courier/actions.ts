"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { noAngle, str, type ActionState } from "@/lib/admin/action-state";
import { friendlyDbError } from "@/lib/db-errors";
import { normalizeBdPhone } from "@/lib/geo/bd";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  default_courier: z.enum(["manual", "pathao", "steadfast", "redx"]),
  pickup_name: z.string().max(80).refine(noAngle, "No angle brackets"),
  pickup_phone: z.string().max(20),
  pickup_address: z.string().max(200).refine(noAngle, "No angle brackets"),
  parcel_note: z.string().max(120).refine(noAngle, "No angle brackets"),
});

export async function saveCourierSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("settings.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const keys = ["default_courier", "pickup_name", "pickup_phone", "pickup_address", "parcel_note"] as const;
  const parsed = schema.safeParse(Object.fromEntries(keys.map((k) => [k, str(fd, k)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const phone = parsed.data.pickup_phone ? normalizeBdPhone(parsed.data.pickup_phone) : "";
  if (phone === null) return { ok: false, message: "Pickup phone must be a Bangladesh mobile number." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_site_setting", { p_key: "shipping.courier", p_value: { ...parsed.data, pickup_phone: phone } });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Courier settings saved." };
}
