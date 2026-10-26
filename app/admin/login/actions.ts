"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export type LoginState = { error: string | null };

export async function signInStaff(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const h = await headers();
  const ip = clientIp(h);
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  // Per-IP limit is generous enough for several staff behind one office NAT; the per-account limit is the tight one.
  const byIp = rateLimit(`admin-login-ip:${ip}`, 30, 15 * 60_000);
  const byEmail = rateLimit(`admin-login-email:${parsed.data.email.toLowerCase()}`, 5, 15 * 60_000);
  if (!byIp.ok || !byEmail.ok) return { error: "Too many attempts. Try again in a few minutes." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Same message for unknown user / wrong password to avoid account enumeration.
  if (error) return { error: "Email or password is incorrect." };
  redirect("/admin/mfa");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
