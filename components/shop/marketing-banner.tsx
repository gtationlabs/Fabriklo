import Link from "next/link";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { nowMs } from "@/lib/time";

type Banner = { enabled?: boolean; text?: string; href?: string; starts_at?: string | null; ends_at?: string | null };

/** Site-wide announcement bar managed under Admin → Marketing (public setting, text only). */
export async function MarketingBanner() {
  const { data } = await createSupabasePublicClient().from("site_settings").select("value").eq("key", "marketing.banner").maybeSingle();
  const b = (data?.value ?? null) as Banner | null;
  if (!b?.enabled || !b.text) return null;
  const now = nowMs();
  if (b.starts_at && Date.parse(b.starts_at) > now) return null;
  if (b.ends_at && Date.parse(b.ends_at) < now) return null;
  const href = b.href && /^\/[^\s]*$/.test(b.href) ? b.href : null;
  return (
    <div className="bg-bronze text-center text-sm text-cream" data-testid="marketing-banner">
      <div className="mx-auto max-w-7xl px-4 py-2">{href ? <Link href={href} className="underline-offset-4 hover:underline">{b.text}</Link> : b.text}</div>
    </div>
  );
}
