"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { noAngle, str, type ActionState } from "@/lib/admin/action-state";
import { friendlyDbError } from "@/lib/db-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  status: z.enum(["open", "contacted", "recovered", "lost"]),
  staff_note: z.string().max(500, "Note: at most 500 characters").refine(noAngle, "No angle brackets"),
});

export async function updateLead(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("orders.fulfill");
  if (!auth.ok) return { ok: false, message: auth.message };
  const parsed = schema.safeParse({ status: str(fd, "status"), staff_note: str(fd, "staff_note") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = { status: parsed.data.status, staff_note: parsed.data.staff_note || null };
  if (parsed.data.status === "contacted") patch.contacted_at = new Date().toISOString();
  const { error } = await supabase.from("checkout_leads").update(patch).eq("id", id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/checkout-leads");
  return { ok: true, message: "Lead updated." };
}

export async function deleteLead(id: string): Promise<ActionState> {
  const auth = await checkStaff("customers.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("checkout_leads").delete().eq("id", id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/checkout-leads");
  return { ok: true, message: "Deleted." };
}
