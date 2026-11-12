import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Panel, StorePage } from "@/components/shop/store-page";
import { ResetForm } from "@/components/account/auth-forms";
import { getCustomer } from "@/lib/account/session";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPage() {
  if (!(await getCustomer())) redirect("/account/login?error=link");
  return (
    <StorePage title="Choose a new password" width="narrow" crumbs={[{ href: "/account", label: "My account" }, { label: "New password" }]}>
      <Panel><ResetForm /></Panel>
    </StorePage>
  );
}
