import type { Metadata } from "next";
import { Turnstile } from "@/components/security/turnstile";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { Panel, StorePage, btnOutline } from "@/components/shop/store-page";
import { LoginForm } from "@/components/account/auth-forms";
import { getCustomer } from "@/lib/account/session";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };
const safeNext = (v: unknown) => (typeof v === "string" && /^\/[A-Za-z0-9/_?=&.-]*$/.test(v) && !v.startsWith("//") ? v : "/account");

export default async function LoginPage({ searchParams }: PageProps<"/account/login">) {
  const sp = await searchParams;
  if (await getCustomer()) redirect(safeNext(sp.next));
  return (
    <StorePage title="Sign in" crumbs={[{ href: "/account", label: "My account" }, { label: "Sign in" }]} intro="See your orders and saved addresses. You can also check out without an account.">
      <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
        <Panel title="Returning customer">
          <LoginForm next={safeNext(sp.next)} linkError={sp.error === "link"} challenge={<Turnstile action="login" />} />
        </Panel>
        <Panel title="New here?" tone="mist">
          <p className="text-[14px] text-neutral-700">An account is optional, but it makes the next order quicker.</p>
          <ul className="mt-4 space-y-2.5 text-[14px] text-neutral-700">
            {["Your order history and live status in one place", "Saved delivery addresses that fill in at checkout", "Private AI try-on photos you can delete any time"].map((t) => (
              <li key={t} className="flex gap-2.5"><Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />{t}</li>
            ))}
          </ul>
          <Link href={`/account/register?next=${encodeURIComponent(safeNext(sp.next))}`} className={`${btnOutline} mt-6 w-full`}>Register now</Link>
        </Panel>
      </div>
    </StorePage>
  );
}
