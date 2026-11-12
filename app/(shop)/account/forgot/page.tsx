import type { Metadata } from "next";
import { Panel, StorePage } from "@/components/shop/store-page";
import { ForgotForm } from "@/components/account/auth-forms";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPage() {
  return (
    <StorePage title="Reset your password" width="narrow" crumbs={[{ href: "/account/login", label: "Sign in" }, { label: "Reset password" }]} intro="We'll email you a link to choose a new password.">
      <Panel><ForgotForm /></Panel>
    </StorePage>
  );
}
