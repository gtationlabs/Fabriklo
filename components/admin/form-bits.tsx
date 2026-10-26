"use client";

import type { FieldErrors } from "@/lib/catalog/admin-schemas";

export function Field({
  label,
  name,
  errors,
  hint,
  children,
}: {
  label: string;
  name: string;
  errors?: FieldErrors;
  hint?: string;
  children: React.ReactNode;
}) {
  const err = errors?.[name];
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-espresso">
        {label}
      </label>
      {children}
      {hint && !err ? <p className="text-xs text-muted">{hint}</p> : null}
      {err ? (
        <p id={`${name}-error`} className="text-xs text-danger">
          {err}
        </p>
      ) : null}
    </div>
  );
}

export const inputCls = "w-full rounded border border-line bg-white px-3 py-2 text-sm aria-[invalid=true]:border-danger";

export function FormMessage({ state }: { state: { ok: boolean; message: string | null } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
      {state.message}
    </p>
  );
}
