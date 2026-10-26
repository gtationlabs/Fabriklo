import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");
// Analytics tags are only loaded with the visitor's consent, and only when configured.
const ga4 = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ? ["https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com"] : [];
const pixel = process.env.NEXT_PUBLIC_META_PIXEL_ID ? ["https://connect.facebook.net", "https://www.facebook.com"] : [];

/**
 * Content Security Policy. Scripts are limited to our own origin; 'unsafe-inline'
 * is still required for Next.js bootstrap scripts until nonce-based CSP is wired
 * (tracked in IMPLEMENTATION_STATUS.md). Payment/analytics domains are added
 * explicitly when those integrations land.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${ga4[0] ?? ""} ${pixel[0] ?? ""}`.replace(/\s+/g, " ").trim(),
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseOrigin} ${[...ga4, ...pixel].join(" ")}`.replace(/\s+/g, " ").trim(),
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs} ${[...ga4, ...pixel].join(" ")}`.replace(/\s+/g, " ").trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

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
