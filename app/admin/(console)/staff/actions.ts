"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { friendlyDbError } from "@/lib/db-errors";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Staff management. Membership rows are written AS THE ACTING USER through RLS
 * (staff.manage; super_admin assignments only by a super_admin; nobody edits
 * their own row; the last active super admin is protected by a trigger).
 *
 * Two steps need the Auth admin API and therefore the service client: creating
 * an invited account (an invite link, shown once, that we never email from the
 * sandbox) and deleting a member's authenticator factors. Both run only after
 * the permission check above and are recorded in the audit log under the acting
 * staff member's identity via admin_record_staff_event.
 */
export type StaffActionState = { ok: boolean; message: string | null; link?: string; values?: Record<string, string> };

const ASSIGNABLE = ["admin", "catalog_manager", "inventory_manager", "order_manager", "support_agent", "marketing_manager", "content_editor", "analyst", "super_admin"] as const;
const inviteSchema = z.object({
  email: z.email().max(254),
  display_name: z.string().trim().min(2).max(120),
  role_code: z.enum(ASSIGNABLE),
});

function echo(fd: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v.slice(0, 300);
  return out;
}

export async function inviteStaff(_prev: StaffActionState, fd: FormData): Promise<StaffActionState> {
  const values = echo(fd);
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Enter a valid email, a display name and a role.", values };
  const auth = await checkStaff("staff.manage");
  if (!auth.ok) return { ok: false, message: auth.message, values };
  if (parsed.data.role_code === "super_admin" && auth.staff.role !== "super_admin") {
    return { ok: false, message: "Only a super admin can create another super admin.", values };
  }
  const supabase = await createSupabaseServerClient();
  const email = parsed.data.email.toLowerCase();

  // Existing account (e.g. a customer): just add the membership; they sign in as usual.
  const { data: existingId } = await supabase.rpc("admin_find_user_by_email", { p_email: email });
  let userId = (existingId as string | null) ?? null;
  let link: string | undefined;

  if (!userId) {
    let service: ReturnType<typeof createSupabaseServiceClient>;
    try {
      service = createSupabaseServiceClient();
    } catch {
      return { ok: false, message: "Inviting new accounts needs the server secret key (SUPABASE_SECRET_KEY). Existing accounts can still be added.", values };
    }
    const { data, error } = await service.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: parsed.data.display_name } } });
    if (error || !data.user) return { ok: false, message: "Could not create the invitation.", values };
    userId = data.user.id;
    // Our own acceptance page verifies the hashed token server-side (no email is sent from here).
    const url = new URL("/admin/welcome", publicEnv.NEXT_PUBLIC_SITE_URL);
    url.searchParams.set("token_hash", data.properties.hashed_token);
    link = url.toString();
  }

  const { error: insertError } = await supabase
    .from("staff_members")
    .insert({ user_id: userId, role_code: parsed.data.role_code, display_name: parsed.data.display_name, status: link ? "invited" : "active", created_by: auth.staff.userId });
  if (insertError) {
    return { ok: false, message: insertError.code === "23505" ? "That person is already a staff member." : friendlyDbError(insertError), values };
  }
  if (link) {
    await supabase.rpc("admin_record_staff_event", { p_action: "staff.invite_link", p_user_id: userId, p_detail: { email, role: parsed.data.role_code } });
  }
  revalidatePath("/admin/staff");
  return {
    ok: true,
    message: link ? "Invitation created. Copy the link below and send it to them yourself; it is shown only once." : "Added. They can sign in with their existing password and will be asked to set up MFA.",
    link,
  };
}

/**
 * Best-effort global sign-out after a role change or suspension so the change
 * takes effect immediately, not only on the next permission check. Needs the
 * service key; silently skipped without it (the DB still refuses the next
 * request, so this only shortens the window).
 */
async function revokeSessions(userId: string): Promise<boolean> {
  try {
    const { error } = await createSupabaseServiceClient().auth.admin.signOut(userId, "global");
    return !error;
  } catch {
    return false;
  }
}

const memberSchema = z.object({ user_id: z.uuid() });

export async function changeStaffRole(_prev: StaffActionState, fd: FormData): Promise<StaffActionState> {
  const parsed = memberSchema.extend({ role_code: z.enum(ASSIGNABLE) }).safeParse({ user_id: fd.get("user_id"), role_code: fd.get("role_code") });
  if (!parsed.success) return { ok: false, message: "Pick a role." };
  const auth = await checkStaff("staff.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("staff_members").update({ role_code: parsed.data.role_code }).eq("user_id", parsed.data.user_id).select("user_id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "That change is not allowed (your own row, or a super admin assignment without super admin rights)." };
  const revoked = await revokeSessions(parsed.data.user_id);
  revalidatePath("/admin/staff");
  return { ok: true, message: revoked ? "Role updated and their sessions signed out." : "Role updated. It applies to their next request." };
}

export async function setStaffStatus(_prev: StaffActionState, fd: FormData): Promise<StaffActionState> {
  const parsed = memberSchema.extend({ status: z.enum(["active", "suspended"]) }).safeParse({ user_id: fd.get("user_id"), status: fd.get("status") });
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const auth = await checkStaff("staff.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("staff_members").update({ status: parsed.data.status }).eq("user_id", parsed.data.user_id).select("user_id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "That change is not allowed." };
  const revoked = parsed.data.status === "suspended" ? await revokeSessions(parsed.data.user_id) : false;
  revalidatePath("/admin/staff");
  return { ok: true, message: parsed.data.status === "suspended" ? (revoked ? "Suspended and signed out everywhere." : "Suspended. Their next request to the admin is refused.") : "Reactivated." };
}

export async function resetStaffMfa(_prev: StaffActionState, fd: FormData): Promise<StaffActionState> {
  const parsed = memberSchema.safeParse({ user_id: fd.get("user_id") });
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const auth = await checkStaff("staff.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { data: allowed } = await supabase.rpc("admin_can_reset_mfa", { p_user_id: parsed.data.user_id });
  if (!allowed) return { ok: false, message: "You cannot reset this member's authenticator." };
  let service: ReturnType<typeof createSupabaseServiceClient>;
  try {
    service = createSupabaseServiceClient();
  } catch {
    return { ok: false, message: "Resetting an authenticator needs the server secret key (SUPABASE_SECRET_KEY)." };
  }
  const { data: factors, error } = await service.auth.admin.mfa.listFactors({ userId: parsed.data.user_id });
  if (error) return { ok: false, message: "Could not read their authenticator factors." };
  let removed = 0;
  for (const f of factors?.factors ?? []) {
    const { error: delError } = await service.auth.admin.mfa.deleteFactor({ id: f.id, userId: parsed.data.user_id });
    if (!delError) removed += 1;
  }
  // Recorded under the acting staff member (the RPC re-checks the permission and the super-admin rule).
  await supabase.rpc("admin_record_staff_event", { p_action: "staff.mfa_reset", p_user_id: parsed.data.user_id, p_detail: { factors_removed: removed } });
  revalidatePath("/admin/staff");
  return { ok: true, message: `Authenticator reset (${removed} factor${removed === 1 ? "" : "s"} removed). They will enrol a new one at their next sign-in.` };
}

export async function passwordResetLink(_prev: StaffActionState, fd: FormData): Promise<StaffActionState> {
  const parsed = memberSchema.extend({ email: z.email() }).safeParse({ user_id: fd.get("user_id"), email: fd.get("email") });
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const auth = await checkStaff("staff.manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (parsed.data.user_id === auth.staff.userId) return { ok: false, message: "Use the sign-in page's reset for your own account." };
  const supabase = await createSupabaseServerClient();
  const { data: knownId } = await supabase.rpc("admin_find_user_by_email", { p_email: parsed.data.email });
  if (knownId !== parsed.data.user_id) return { ok: false, message: "That member was not found." };
  let service: ReturnType<typeof createSupabaseServiceClient>;
  try {
    service = createSupabaseServiceClient();
  } catch {
    return { ok: false, message: "Password reset links need the server secret key (SUPABASE_SECRET_KEY)." };
  }
  const { data, error } = await service.auth.admin.generateLink({ type: "recovery", email: parsed.data.email });
  if (error || !data.properties) return { ok: false, message: "Could not create a reset link." };
  const url = new URL("/admin/welcome", publicEnv.NEXT_PUBLIC_SITE_URL);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("type", "recovery");
  await supabase.rpc("admin_record_staff_event", { p_action: "staff.password_reset_link", p_user_id: parsed.data.user_id, p_detail: null });
  return { ok: true, message: "Reset link created. Send it to them yourself; it is shown only once and expires.", link: url.toString() };
}
