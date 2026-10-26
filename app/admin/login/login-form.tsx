"use client";

import { useActionState } from "react";
import { signInStaff, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInStaff, { error: null });
  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-espresso">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="mt-1 w-full rounded border border-line bg-white px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-espresso">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded border border-line bg-white px-3 py-2" />
      </div>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="w-full rounded bg-espresso px-4 py-2.5 font-medium text-cream disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
