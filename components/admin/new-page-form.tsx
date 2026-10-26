"use client";

import { useActionState } from "react";
import { createPage, type PageActionState } from "@/app/admin/(console)/content/pages/actions";
import { FormMessage, inputCls } from "@/components/admin/form-bits";

const idle: PageActionState = { ok: false, message: null };

export function NewPageForm() {
  const [state, action, pending] = useActionState(createPage, idle);
  return (
    <form action={action} aria-label="New page" className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium">Title<input name="title" defaultValue={state.values?.title ?? ""} maxLength={140} required className={inputCls} /></label>
      <label className="text-xs font-medium">Address (/slug)<input name="slug" defaultValue={state.values?.slug ?? ""} maxLength={80} required className={inputCls} /></label>
      <input type="hidden" name="page_kind" value="page" />
      <button type="submit" disabled={pending} className="rounded bg-espresso px-3 py-2 text-sm text-cream disabled:opacity-60">Create draft</button>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}
