"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import { idleState, type ActionState } from "@/lib/admin/action-state";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action. Submits without React's automatic form reset,
 * so a rejected value stays in the field; the page re-renders from the database
 * after a successful save (the action revalidates its path).
 */
export function ActionForm({
  action,
  label,
  submitLabel,
  children,
  className = "space-y-4",
  danger = false,
  confirm,
  compact = false,
  testId,
}: {
  action: Action;
  label: string;
  submitLabel: string;
  children?: React.ReactNode;
  className?: string;
  danger?: boolean;
  confirm?: string;
  compact?: boolean;
  testId?: string;
}) {
  const [state, run, pending] = useActionState(action, idleState);
  const [, startTransition] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => run(fd));
  };
  const btn = danger
    ? "rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/5 disabled:opacity-60"
    : "rounded-lg bg-espresso px-4 py-2 text-sm font-medium text-cream hover:bg-espresso/90 disabled:opacity-60";
  return (
    <form onSubmit={onSubmit} aria-label={label} className={compact ? "inline-flex items-center gap-2" : className} data-testid={testId}>
      {children}
      <div className={compact ? "contents" : "flex flex-wrap items-center gap-3"}>
        <button type="submit" disabled={pending} className={btn}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {state.message ? (
          <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
      {state.secret ? (
        <div className="rounded-lg border border-bronze/40 bg-cream p-3 text-sm" data-testid="one-time-secret">
          <p className="font-medium text-espresso">Copy this now. It is shown only once.</p>
          <code className="mt-1 block break-all font-mono text-xs">{state.secret}</code>
        </div>
      ) : null}
    </form>
  );
}
