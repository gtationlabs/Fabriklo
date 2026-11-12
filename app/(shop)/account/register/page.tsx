import type { Metadata } from "next";
import { Turnstile } from "@/components/security/turnstile";
import { redirect } from "next/navigation";
import { Panel, StorePage } from "@/components/shop/store-page";
import { RegisterForm } from "@/components/account/auth-forms";
import { getCustomer } from "@/lib/account/session";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };
const safeNext = (v: unknown) => (typeof v === "string" && /^\/[A-Za-z0-9/_?=&.-]*$/.test(v) && !v.startsWith("//") ? v : "/account");

export default async function RegisterPage({ searchParams }: PageProps<"/account/register">) {
  const sp = await searchParams;
  if (await getCustomer()) redirect(safeNext(sp.next));
  return (
    <StorePage title="Create an account" width="narrow" crumbs={[{ href: "/account", label: "My account" }, { label: "Register" }]} intro="Keep your addresses and see your order history.">
      <Panel><RegisterForm next={safeNext(sp.next)} challenge={<Turnstile action="register" />} /></Panel>
    </StorePage>
  );
}
