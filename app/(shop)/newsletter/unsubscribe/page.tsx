import type { Metadata } from "next";
import Link from "next/link";
import { createSupabasePublicClient } from "@/lib/supabase/public";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

export default async function NewsletterUnsubscribePage({ searchParams }: PageProps<"/newsletter/unsubscribe">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token.trim() : "";
  let ok = false;
  if (/^[0-9a-f]{48}$/.test(token)) {
    const { data } = await createSupabasePublicClient().rpc("newsletter_unsubscribe", { p_token: token });
    ok = Boolean((data as { ok?: boolean } | null)?.ok);
  }
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">{ok ? "You're unsubscribed" : "That link didn't work"}</h1>
      <p className="mt-3 text-muted" data-testid="newsletter-unsubscribe-result">
        {ok ? "You won't receive marketing emails from us. Order updates for purchases you make are still sent." : "The unsubscribe link is invalid. Use the link at the bottom of any of our emails."}
      </p>
      <Link href="/shop" className="mt-8 inline-block rounded bg-espresso px-5 py-3 text-sm font-medium text-cream">Back to the store</Link>
    </div>
  );
}
