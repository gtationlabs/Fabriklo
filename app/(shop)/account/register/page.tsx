import type { Metadata } from "next";
import { Turnstile } from "@/components/security/turnstile";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/account/auth-forms";
import { getCustomer } from "@/lib/account/session";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };
const safeNext = (v: unknown) => (typeof v === "string" && /^\/[A-Za-z0-9/_?=&.-]*$/.test(v) && !v.startsWith("//") ? v : "/account");

export default async function RegisterPage({ searchParams }: PageProps<"/account/register">) {
  const sp = await searchParams;
  if (await getCustomer()) redirect(safeNext(sp.next));
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">Create an account</h1>
      <p className="mt-2 text-sm text-muted">Keep your addresses and see your order history.</p>
      <div className="mt-8"><RegisterForm next={safeNext(sp.next)} challenge={<Turnstile action="register" />} /></div>
    </div>
  );
}
