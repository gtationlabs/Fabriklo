"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Invitation / password-reset acceptance for staff. The hashed token from the
 * link is verified server-side (verifyOtp), which starts a session in cookies;
 * the member then sets a password and continues to MFA enrolment.
 */
export type WelcomeState = { error: string | null; step: "accept" | "password" };

const tokenSchema = z.object({ token_hash: z.string().regex(/^[a-zA-Z0-9_-]{16,200}$/), type: z.enum(["invite", "recovery"]) });

export async function acceptInvite(_prev: WelcomeState, fd: FormData): Promise<WelcomeState> {
  const parsed = tokenSchema.safeParse({ token_hash: fd.get("token_hash"), type: fd.get("type") ?? "invite" });
  if (!parsed.success) return { error: "That link is not valid.", step: "accept" };
  const ip = clientIp(await headers());
  if (!rateLimit(`staff-welcome:${ip}`, 10, 15 * 60_000).ok) return { error: "Too many attempts. Try again later.", step: "accept" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: parsed.data.token_hash, type: parsed.data.type });
  if (error) return { error: "That link has expired or was already used. Ask an admin for a new one.", step: "accept" };
  return { error: null, step: "password" };
}

const password = z.string().min(12, "Use at least 12 characters").max(200).refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), "Use letters and numbers");

export async function setStaffPassword(_prev: WelcomeState, fd: FormData): Promise<WelcomeState> {
  const parsed = z.object({ password, confirm: z.string() }).safeParse({ password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a stronger password.", step: "password" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "The two passwords do not match.", step: "password" };
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Your invitation session ended. Open the link again.", step: "accept" };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: /password/i.test(error.message) ? "Choose a stronger password (12+ characters with letters and numbers)." : "Could not save the password.", step: "password" };
  redirect("/admin/mfa");
}
