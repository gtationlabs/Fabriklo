import { NextResponse } from "next/server";
import { checkStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** CSV of confirmed subscribers (marketing.manage). Audited by the row read; no tokens are included. */
export async function GET() {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return new NextResponse("Forbidden", { status: 403 });
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("newsletter_subscriptions").select("email, source, confirmed_at").eq("status", "subscribed").order("confirmed_at").limit(10000);
  const esc = (v: string | null) => `"${String(v ?? "").replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  const csv = ["email,source,confirmed_at", ...(data ?? []).map((r) => [r.email, r.source, r.confirmed_at].map(esc).join(","))].join("\r\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=newsletter-subscribers.csv", "Cache-Control": "no-store" } });
}
