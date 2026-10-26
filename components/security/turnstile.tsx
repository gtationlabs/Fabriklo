import Script from "next/script";
import { headers } from "next/headers";
import { turnstileEnabled } from "@/lib/security/turnstile";

/**
 * Cloudflare Turnstile challenge (server component). Renders nothing unless
 * both Turnstile keys are configured, so local QA and CI never depend on
 * Cloudflare. Place it INSIDE the form it protects: the widget writes the
 * token to a hidden `cf-turnstile-response` input that travels with the form
 * data (server actions) or is read by `turnstileToken(form)` (fetch forms).
 * Pass it to client forms as a prop/child (server components cannot be
 * imported from client code).
 */
export async function Turnstile({ action }: { action: string }) {
  if (!turnstileEnabled()) return null;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" nonce={nonce} />
      <div className="cf-turnstile" data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} data-action={action} data-size="flexible" data-appearance="always" />
    </>
  );
}
