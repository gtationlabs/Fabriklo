import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, makeNonce, sentryOriginFromDsn } from "@/lib/security/csp";

/**
 * Per request:
 *  1. a fresh CSP nonce is minted and forwarded to the app as `x-nonce`
 *     (Next.js reads it for its own bootstrap scripts; our <Script> tags read
 *     it via headers()), and the matching Content-Security-Policy header is
 *     set on the response (the static headers in next.config.ts cover the
 *     rest; CSP must be per request because of the nonce);
 *  2. the Supabase session cookie is refreshed;
 *  3. anonymous visitors are bounced away from /admin. This is a convenience
 *     only: every admin page, server action and database policy re-checks
 *     authorisation independently.
 */
export async function proxy(request: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV !== "production",
    supabaseOrigin: originOf(process.env.NEXT_PUBLIC_SUPABASE_URL),
    ga4: Boolean(process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID),
    pixel: Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID),
    turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
    sentryOrigin: sentryOriginFromDsn(process.env.NEXT_PUBLIC_SENTRY_DSN),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const next = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  let response = next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = next();
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  // /admin/welcome verifies an invitation / reset token itself (no session yet).
  const isAdminPublic = path === "/admin/login" || path === "/admin/welcome";
  if (path.startsWith("/admin") && !isAdminPublic && !data?.claims?.sub) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }
  return response;
}

function originOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/|api/products|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)"],
};
