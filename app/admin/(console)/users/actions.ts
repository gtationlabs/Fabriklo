"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { str, type ActionState } from "@/lib/admin/action-state";
import { friendlyDbError } from "@/lib/db-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function setCustomerDisabled(userId: string, disabled: boolean, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("customers.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!z.uuid().safeParse(userId).success) return { ok: false, message: "Unknown customer." };
  const reason = str(fd, "reason");
  if (reason.length < 3) return { ok: false, message: "Give a short reason (it goes in the audit log)." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_customer_disabled", { p_user_id: userId, p_disabled: disabled, p_reason: reason });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/users");
  return { ok: true, message: disabled ? "Account disabled. They can no longer use their account or write reviews." : "Account enabled again." };
}
