"use client";

import { useActionState } from "react";
import { inputCls } from "@/components/admin/form-bits";
import { acceptInvite, setStaffPassword, type WelcomeState } from "./actions";

export function WelcomeForm({ tokenHash, type }: { tokenHash: string; type: "invite" | "recovery" }) {
  const [accept, acceptAction, accepting] = useActionState(acceptInvite, { error: null, step: "accept" } as WelcomeState);
  const [pw, pwAction, saving] = useActionState(setStaffPassword, { error: null, step: "password" } as WelcomeState);
  const step = pw.step === "accept" ? "accept" : accept.step;
  const error = step === "accept" ? accept.error ?? pw.error : pw.error;

  if (step === "accept") {
    return (
      <form action={acceptAction} className="space-y-4">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <p className="text-sm text-muted">{type === "invite" ? "Accept the invitation to create your staff password." : "Continue to choose a new password."}</p>
        {error ? <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p> : null}
        <button type="submit" disabled={accepting} className="w-full rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">
          {accepting ? "Checking…" : type === "invite" ? "Accept invitation" : "Continue"}
        </button>
      </form>
    );
  }
  return (
    <form action={pwAction} className="space-y-4">
      <label className="block text-sm">
        <span className="font-medium">New password</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} className={inputCls} />
        <span className="text-xs text-muted">At least 12 characters with letters and numbers.</span>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Confirm password</span>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} className={inputCls} />
      </label>
      {error ? <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p> : null}
      <button type="submit" disabled={saving} className="w-full rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">
        {saving ? "Saving…" : "Save password and set up MFA"}
      </button>
    </form>
  );
}
