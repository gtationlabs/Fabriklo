import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetForm } from "@/components/account/auth-forms";
import { getCustomer } from "@/lib/account/session";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPage() {
  if (!(await getCustomer())) redirect("/account/login?error=link");
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">Choose a new password</h1>
      <div className="mt-8"><ResetForm /></div>
    </div>
  );
}
