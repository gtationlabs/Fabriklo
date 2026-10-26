import type { Metadata } from "next";
import { ForgotForm } from "@/components/account/auth-forms";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">Reset your password</h1>
      <p className="mt-2 text-sm text-muted">We&apos;ll email you a link to choose a new password.</p>
      <div className="mt-8"><ForgotForm /></div>
    </div>
  );
}
