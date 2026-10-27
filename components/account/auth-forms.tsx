"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  registerCustomer,
  requestPasswordReset,
  setNewPassword,
  signInCustomer,
  type AccountState,
} from "@/app/(shop)/account/actions";

const idle: AccountState = { ok: false, message: null };
export const input = "mt-1 w-full rounded border border-line bg-white px-3 py-2.5 text-espresso focus:border-bronze focus:outline-none focus:ring-2 focus:ring-bronze/30";
const btn = "w-full rounded bg-espresso px-5 py-3 font-medium text-cream hover:bg-charcoal disabled:opacity-60";

export function Message({ state }: { state: AccountState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`rounded border p-3 text-sm ${state.ok ? "border-success/30 bg-success/5 text-success" : "border-danger/30 bg-danger/5 text-danger"}`}>
      {state.message}
    </p>
  );
}

export function LoginForm({ next, linkError, challenge }: { next: string; linkError?: boolean; challenge?: React.ReactNode }) {
  const [state, action, pending] = useActionState(signInCustomer, idle);
  return (
    <form action={action} className="space-y-4" aria-label="Sign in">
      <input type="hidden" name="next" value={next} />
      {linkError ? <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">That link has expired or was already used.</p> : null}
      <Message state={state} />
      <label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="email" required defaultValue={state.values?.email ?? ""} className={input} /></label>
      <label className="block text-sm font-medium">Password<input name="password" type="password" autoComplete="current-password" required className={input} /></label>
      {challenge}
      <button type="submit" disabled={pending} className={btn}>{pending ? "Signing in…" : "Sign in"}</button>
      <p className="text-sm text-muted">
        <Link href="/account/forgot" className="underline">Forgot your password?</Link> · New here?{" "}
        <Link href={`/account/register?next=${encodeURIComponent(next)}`} className="underline">Create an account</Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next, challenge }: { next: string; challenge?: React.ReactNode }) {
  const [state, action, pending] = useActionState(registerCustomer, idle);
  return (
    <form action={action} className="space-y-4" aria-label="Create account">
      <input type="hidden" name="next" value={next} />
      <Message state={state} />
      <label className="block text-sm font-medium">Full name<input name="full_name" autoComplete="name" required defaultValue={state.values?.full_name ?? ""} className={input} /></label>
      <label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="email" required defaultValue={state.values?.email ?? ""} className={input} /></label>
      <label className="block text-sm font-medium">
        Password <span className="font-normal text-muted">(10+ characters, letters and numbers)</span>
        <input name="password" type="password" autoComplete="new-password" minLength={10} required className={input} />
      </label>
      {challenge}
      <button type="submit" disabled={pending} className={btn}>{pending ? "Creating…" : "Create account"}</button>
      <p className="text-sm text-muted">Already have one? <Link href={`/account/login?next=${encodeURIComponent(next)}`} className="underline">Sign in</Link></p>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, idle);
  return (
    <form action={action} className="space-y-4" aria-label="Reset password">
      <Message state={state} />
      <label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="email" required defaultValue={state.values?.email ?? ""} className={input} /></label>
      <button type="submit" disabled={pending} className={btn}>Send reset link</button>
    </form>
  );
}

export function ResetForm() {
  const [state, action, pending] = useActionState(setNewPassword, idle);
  return (
    <form action={action} className="space-y-4" aria-label="Choose a new password">
      <Message state={state} />
      {state.ok ? <Link href="/account" className="underline">Go to your account</Link> : null}
      <label className="block text-sm font-medium">New password<input name="password" type="password" autoComplete="new-password" minLength={10} required className={input} /></label>
      <label className="block text-sm font-medium">Confirm password<input name="confirm" type="password" autoComplete="new-password" minLength={10} required className={input} /></label>
      <button type="submit" disabled={pending} className={btn}>Update password</button>
    </form>
  );
}
