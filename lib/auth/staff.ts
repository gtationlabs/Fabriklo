import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Permission } from "./permissions";

export type StaffContext = {
  userId: string;
  email: string | null;
  role: string;
  displayName: string;
  permissions: Permission[];
  aal: "aal1" | "aal2";
};

export type StaffState =
  | { kind: "anonymous" }
  | { kind: "not_staff"; email: string | null }
  | { kind: "needs_mfa"; email: string | null; hasVerifiedFactor: boolean }
  | { kind: "ok"; staff: StaffContext };

type DbStaffContext = {
  is_staff: boolean;
  status: string | null;
  role: string | null;
  display_name: string | null;
  permissions: string[];
  aal: string;
};

/**
 * Resolves the caller's staff state from a VERIFIED token (getClaims validates the
 * JWT signature) and the CURRENT role rows in Postgres. Never trusts user_metadata.
 */
export const getStaffState = cache(async (): Promise<StaffState> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (error || !claims?.sub) return { kind: "anonymous" };
  const email = (claims.email as string | undefined) ?? null;

  const { data, error: ctxError } = await supabase.rpc("my_staff_context");
  if (ctxError || !data) return { kind: "not_staff", email };
  let ctx = data as DbStaffContext;
  if (!ctx.is_staff) return { kind: "not_staff", email };

  if (claims.aal !== "aal2") {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const hasVerifiedFactor = (factors?.totp ?? []).some((f) => f.status === "verified");
    return { kind: "needs_mfa", email, hasVerifiedFactor };
  }

  // An invited member becomes active on their first verified session (audited in SQL).
  // Concurrent requests may race here: whichever loses re-reads the now-active row.
  if (ctx.status === "invited") {
    await supabase.rpc("staff_activate_self");
    const { data: fresh } = await supabase.rpc("my_staff_context");
    ctx = (fresh ?? null) as DbStaffContext | null ?? ctx;
    if (!ctx.is_staff || ctx.status !== "active") return { kind: "not_staff", email };
  }
  if (ctx.status !== "active") return { kind: "not_staff", email };

  return {
    kind: "ok",
    staff: {
      userId: claims.sub,
      email,
      role: ctx.role ?? "",
      displayName: ctx.display_name || email || "Staff",
      permissions: ctx.permissions as Permission[],
      aal: "aal2",
    },
  };
});

/** Use at the top of every admin page/action. Redirects when not authorised. */
export async function requireStaff(permission?: Permission): Promise<StaffContext> {
  const state = await getStaffState();
  if (state.kind === "anonymous") redirect("/admin/login");
  if (state.kind === "not_staff") redirect("/admin/login?error=not_staff");
  if (state.kind === "needs_mfa") redirect("/admin/mfa");
  if (permission && !state.staff.permissions.includes(permission)) {
    redirect("/admin?denied=" + encodeURIComponent(permission));
  }
  return state.staff;
}

/** For server actions: returns an error instead of redirecting. */
export async function checkStaff(
  permission: Permission,
): Promise<{ ok: true; staff: StaffContext } | { ok: false; message: string }> {
  const state = await getStaffState();
  if (state.kind !== "ok") return { ok: false, message: "Your session has expired. Sign in again with MFA." };
  if (!state.staff.permissions.includes(permission)) {
    return { ok: false, message: "You do not have permission to do that." };
  }
  return { ok: true, staff: state.staff };
}
