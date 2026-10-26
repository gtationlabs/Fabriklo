import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
// Content-Security-Policy is set per request in proxy.ts (nonce-based, see
// lib/security/csp.ts). The headers below are static and apply to every route.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  } catch {
    return "";
  }
})();

const nextConfig: NextConfig = {
  // Cache Components is off for now: almost every commerce route reads the
  // session/cart cookie, and keeping the classic dynamic model makes auth
  // behaviour easier to reason about. Revisit for catalog pages later.
  cacheComponents: false,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: supabaseOrigin
      ? [{ protocol: new URL(supabaseOrigin).protocol.replace(":", "") as "http" | "https", hostname: new URL(supabaseOrigin).hostname, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/(admin|account|cart|checkout|orders)(.*)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
