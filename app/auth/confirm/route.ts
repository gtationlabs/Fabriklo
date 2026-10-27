import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Exchanges an email-link code (sign-up confirmation, password reset) for a session. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const rawNext = url.searchParams.get("next") ?? "/account";
  const next = /^\/[A-Za-z0-9/_?=&.-]*$/.test(rawNext) && !rawNext.startsWith("//") ? rawNext : "/account";
  const supabase = await createSupabaseServerClient();
  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && (type === "recovery" || type === "signup" || type === "email")) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }
  return NextResponse.redirect(new URL(ok ? next : "/account/login?error=link", url.origin));
}
