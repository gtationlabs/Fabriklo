import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Staff sign in" };

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-white p-8 shadow-sm">
        <p className="font-display text-2xl font-semibold text-espresso">Fabriklo</p>
        <h1 className="mt-1 text-sm text-muted">Staff sign in. Two-factor authentication is required.</h1>
        {error === "not_staff" ? (
          <div role="alert" className="mt-4 rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            This account does not have staff access.
            <form action={signOut} className="mt-2">
              <button className="underline">Sign out</button>
            </form>
          </div>
        ) : null}
        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
