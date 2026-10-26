import type { Metadata } from "next";
import Link from "next/link";
import { createSupabasePublicClient } from "@/lib/supabase/public";

export const metadata: Metadata = { title: "Confirm subscription", robots: { index: false, follow: false } };

export default async function NewsletterConfirmPage({ searchParams }: PageProps<"/newsletter/confirm">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token.trim() : "";
  let ok = false;
  if (/^[0-9a-f]{48}$/.test(token)) {
    const { data } = await createSupabasePublicClient().rpc("newsletter_confirm", { p_token: token });
    ok = Boolean((data as { ok?: boolean } | null)?.ok);
  }
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">{ok ? "You're subscribed" : "That link didn't work"}</h1>
      <p className="mt-3 text-muted" data-testid="newsletter-confirm-result">
        {ok ? "Thanks for confirming. You can unsubscribe from any email with one click." : "The confirmation link is invalid, already used, or has expired. Subscribe again from the footer to get a new one."}
      </p>
      <Link href="/shop" className="mt-8 inline-block rounded bg-espresso px-5 py-3 text-sm font-medium text-cream">Continue shopping</Link>
    </div>
  );
}
