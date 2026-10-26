"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { friendlyDbError } from "@/lib/db-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runWorkerTick } from "@/lib/tryon/service";

export type LimitsState = { ok: boolean; message: string | null };

const limitsSchema = z.object({
  enabled: z.boolean(),
  per_user_daily: z.coerce.number().int().min(0).max(100),
  site_daily: z.coerce.number().int().min(0).max(100000),
  daily_credit_cap: z.coerce.number().int().min(0).max(1000000),
  alert_threshold_pct: z.coerce.number().int().min(1).max(100),
  retention_hours: z.coerce.number().int().min(1).max(168),
  max_attempts: z.coerce.number().int().min(1).max(5),
});

export async function updateTryonLimits(_prev: LimitsState, fd: FormData): Promise<LimitsState> {
  const auth = await checkStaff("tryon.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = limitsSchema.safeParse({
    enabled: fd.get("enabled") === "on",
    per_user_daily: fd.get("per_user_daily"),
    site_daily: fd.get("site_daily"),
    daily_credit_cap: fd.get("daily_credit_cap"),
    alert_threshold_pct: fd.get("alert_threshold_pct"),
    retention_hours: fd.get("retention_hours"),
    max_attempts: fd.get("max_attempts"),
  });
  if (!parsed.success) return { ok: false, message: "Check the numbers: " + parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_tryon_limits", { p_value: parsed.data });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/tryon");
  return { ok: true, message: "Limits saved." };
}

/** Staff can nudge the queue (same as the cron tick). */
export async function runTryonWorkerNow(): Promise<void> {
  const auth = await checkStaff("tryon.manage");
  if (!auth.ok) return;
  await runWorkerTick(5).catch(() => undefined);
  revalidatePath("/admin/tryon");
}
