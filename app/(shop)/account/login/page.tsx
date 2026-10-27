import type { Metadata } from "next";
import { Turnstile } from "@/components/security/turnstile";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/account/auth-forms";
import { getCustomer } from "@/lib/account/session";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };
const safeNext = (v: unknown) => (typeof v === "string" && /^\/[A-Za-z0-9/_?=&.-]*$/.test(v) && !v.startsWith("//") ? v : "/account");

export default async function LoginPage({ searchParams }: PageProps<"/account/login">) {
  const sp = await searchParams;
  if (await getCustomer()) redirect(safeNext(sp.next));
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">Sign in</h1>
      <p className="mt-2 text-sm text-muted">See your orders and saved addresses. You can also check out without an account.</p>
      <div className="mt-8"><LoginForm next={safeNext(sp.next)} linkError={sp.error === "link"} challenge={<Turnstile action="login" />} /></div>
    </div>
  );
}
