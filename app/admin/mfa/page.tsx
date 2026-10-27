import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaffState } from "@/lib/auth/staff";
import { signOut } from "../login/actions";
import { MfaFlow } from "./mfa-flow";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function MfaPage() {
  const state = await getStaffState();
  if (state.kind === "anonymous") redirect("/admin/login");
  if (state.kind === "not_staff") redirect("/admin/login?error=not_staff");
  if (state.kind === "ok") redirect("/admin");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-espresso">
          {state.hasVerifiedFactor ? "Verify it's you" : "Set up two-factor authentication"}
        </h1>
        <p className="mt-1 text-sm text-muted">Signed in as {state.email}. Staff access requires a second factor.</p>
        <div className="mt-6">
          <MfaFlow hasVerifiedFactor={state.hasVerifiedFactor} />
        </div>
        <form action={signOut} className="mt-6 text-center">
          <button className="text-sm text-muted underline">Sign out</button>
        </form>
      </div>
    </main>
  );
}
