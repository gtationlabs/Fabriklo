import type { Metadata } from "next";
import { getStoreIdentity } from "@/lib/settings/public";
import { WelcomeForm } from "./welcome-form";

export const metadata: Metadata = { title: "Staff invitation", robots: { index: false, follow: false } };

export default async function StaffWelcomePage({ searchParams }: PageProps<"/admin/welcome">) {
  const { token_hash, type } = await searchParams;
  const identity = await getStoreIdentity();
  const token = typeof token_hash === "string" && /^[a-zA-Z0-9_-]{16,200}$/.test(token_hash) ? token_hash : null;
  const kind = type === "recovery" ? "recovery" : "invite";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-white p-8 shadow-sm">
        <p className="font-display text-2xl font-semibold text-espresso">{identity.name}</p>
        <h1 className="mt-1 text-sm text-muted">{kind === "invite" ? "Staff invitation" : "Staff password reset"}</h1>
        <div className="mt-6">
          {token ? (
            <WelcomeForm tokenHash={token} type={kind} />
          ) : (
            <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">This link is incomplete. Ask an admin for a new one.</p>
          )}
        </div>
      </div>
    </main>
  );
}
