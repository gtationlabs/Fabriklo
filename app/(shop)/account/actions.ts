"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCustomer } from "@/lib/account/session";
import { publicEnv } from "@/lib/env";
import { BD_DISTRICTS, divisionOf, normalizeBdPhone } from "@/lib/geo/bd";
import { friendlyDbError } from "@/lib/db-errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Customer auth and account actions. Passwords are handled by Supabase Auth;
 * every message is generic where it could reveal whether an email exists.
 */
export type AccountState = { ok: boolean; message: string | null; values?: Record<string, string> };
const idle = { ok: false, message: null };

const email = z.email("Enter a valid email").max(254);
const password = z.string().min(10, "Use at least 10 characters").max(200).refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), "Use letters and numbers");
const safeNext = (v: unknown) => (typeof v === "string" && /^\/[A-Za-z0-9/_?=&.-]*$/.test(v) && !v.startsWith("//") ? v : "/account");

function echo(fd: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !/password/i.test(k) && !k.startsWith("$")) out[k] = v.slice(0, 300);
  return out;
}

export async function registerCustomer(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const values = echo(fd);
  const parsed = z
    .object({ full_name: z.string().trim().min(2, "Enter your name").max(120), email, password })
    .safeParse({ full_name: fd.get("full_name"), email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ...idle, message: parsed.error.issues[0]?.message ?? "Check the fields.", values };
  const ip = clientIp(await headers());
  if (!rateLimit(`register:${ip}`, 5, 60 * 60_000).ok) return { ...idle, message: "Too many sign-ups from this connection. Try later.", values };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.full_name }, emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/account` },
  });
  if (error) {
    if (/password/i.test(error.message)) return { ...idle, message: "Choose a stronger password (10+ characters with letters and numbers).", values };
    if (error.status === 429) return { ...idle, message: "Too many attempts. Try again in a few minutes.", values };
    // Supabase returns an obfuscated user for existing emails; other errors are generic.
    return { ...idle, message: "We couldn't create your account. Please try again.", values };
  }
  if (data.session) redirect(safeNext(fd.get("next")));
  return { ok: true, message: "Check your email to confirm your account, then sign in.", values };
}

export async function signInCustomer(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const values = echo(fd);
  const parsed = z.object({ email, password: z.string().min(1).max(200) }).safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ...idle, message: "Enter your email and password.", values };
  const ip = clientIp(await headers());
  if (!rateLimit(`login-ip:${ip}`, 10, 15 * 60_000).ok || !rateLimit(`login-email:${parsed.data.email.toLowerCase()}`, 5, 15 * 60_000).ok) {
    return { ...idle, message: "Too many attempts. Try again in a few minutes.", values };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ...idle, message: "Email or password is incorrect.", values };
  redirect(safeNext(fd.get("next")));
}

export async function signOutCustomer() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function requestPasswordReset(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const values = echo(fd);
  const parsed = email.safeParse(fd.get("email"));
  if (!parsed.success) return { ...idle, message: "Enter a valid email.", values };
  const ip = clientIp(await headers());
  if (!rateLimit(`reset:${ip}`, 5, 60 * 60_000).ok) return { ...idle, message: "Too many requests. Try later.", values };
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/account/reset` });
  // Always the same answer, whether or not the email exists.
  return { ok: true, message: "If that email has an account, a reset link is on its way.", values };
}

export async function setNewPassword(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const parsed = password.safeParse(fd.get("password"));
  if (!parsed.success) return { ...idle, message: parsed.error.issues[0]?.message ?? "Choose a stronger password." };
  if (parsed.data !== fd.get("confirm")) return { ...idle, message: "The two passwords don't match." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { ...idle, message: "Your reset link has expired. Request a new one." };
  return { ok: true, message: "Password updated." };
}

export async function updateProfile(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const values = echo(fd);
  const customer = await getCustomer();
  if (!customer) return { ...idle, message: "Please sign in again.", values };
  const phoneRaw = String(fd.get("phone") ?? "").trim();
  const phone = phoneRaw ? normalizeBdPhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { ...idle, message: "Enter a Bangladesh mobile number, e.g. 01712 345678", values };
  const parsed = z.string().trim().min(2, "Enter your name").max(120).safeParse(fd.get("full_name"));
  if (!parsed.success) return { ...idle, message: parsed.error.issues[0]?.message, values };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data, phone, marketing_opt_in: fd.get("marketing_opt_in") === "on" })
    .eq("id", customer.id);
  if (error) return { ...idle, message: friendlyDbError(error), values };
  revalidatePath("/account");
  return { ok: true, message: "Details saved." };
}

const addressSchema = z.object({
  label: z.string().trim().min(1).max(40),
  recipient_name: z.string().trim().min(2, "Enter the recipient's name").max(120),
  phone: z.string().transform((v, ctx) => {
    const p = normalizeBdPhone(v);
    if (!p) { ctx.addIssue({ code: "custom", message: "Enter a Bangladesh mobile number" }); return z.NEVER; }
    return p;
  }),
  district: z.string().refine((d) => BD_DISTRICTS.includes(d), "Choose a district"),
  area: z.string().trim().min(2, "Enter the area or thana").max(80),
  address_line: z.string().trim().min(5, "Enter house, road and landmark").max(300),
  postal_code: z.string().trim().optional().refine((v) => !v || /^\d{4}$/.test(v), "Postcodes have 4 digits"),
  is_default: z.boolean(),
});

export async function saveAddress(_prev: AccountState, fd: FormData): Promise<AccountState> {
  const values = echo(fd);
  const customer = await getCustomer();
  if (!customer) return { ...idle, message: "Please sign in again.", values };
  const parsed = addressSchema.safeParse({ ...values, is_default: fd.get("is_default") === "on" });
  if (!parsed.success) return { ...idle, message: parsed.error.issues[0]?.message ?? "Check the address.", values };
  const id = z.uuid().safeParse(fd.get("id"));
  const row = { ...parsed.data, postal_code: parsed.data.postal_code || null, division: divisionOf(parsed.data.district)!, user_id: customer.id };
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase.from("addresses").select("id", { count: "exact", head: true });
  if (!id.success && (count ?? 0) >= 10) return { ...idle, message: "You can keep up to 10 addresses.", values };
  const makeDefault = row.is_default || (count ?? 0) === 0;
  if (makeDefault) await supabase.from("addresses").update({ is_default: false }).eq("user_id", customer.id);
  const q = id.success
    ? supabase.from("addresses").update({ ...row, is_default: makeDefault }).eq("id", id.data)
    : supabase.from("addresses").insert({ ...row, is_default: makeDefault });
  const { error } = await q;
  if (error) return { ...idle, message: friendlyDbError(error), values };
  revalidatePath("/account");
  revalidatePath("/account/addresses");
  return { ok: true, message: "Address saved." };
}

export async function deleteAddress(fd: FormData) {
  const id = z.uuid().safeParse(fd.get("id"));
  const customer = await getCustomer();
  if (!id.success || !customer) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("addresses").delete().eq("id", id.data);
  revalidatePath("/account/addresses");
}
