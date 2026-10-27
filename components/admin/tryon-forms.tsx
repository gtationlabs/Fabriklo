"use client";

import { useActionState } from "react";
import { updateTryonLimits, type LimitsState } from "@/app/admin/(console)/tryon/actions";
import { setTryonGarment, type GarmentState } from "@/app/admin/(console)/products/actions";
import { FormMessage, inputCls } from "./form-bits";

type Limits = { enabled: boolean; per_user_daily: number; site_daily: number; daily_credit_cap: number; alert_threshold_pct: number; retention_hours: number; max_attempts: number };

export function LimitsForm({ limits }: { limits: Limits }) {
  const [state, action, pending] = useActionState<LimitsState, FormData>(updateTryonLimits, { ok: false, message: null });
  const num = (name: keyof Limits, label: string, hint: string) => (
    <label className="block text-sm">
      <span className="font-medium text-espresso">{label}</span>
      <input name={name} type="number" defaultValue={limits[name] as number} className={`mt-1 ${inputCls}`} />
      <span className="text-xs text-muted">{hint}</span>
    </label>
  );
  return (
    <form action={action} aria-label="Try-on limits" className="mt-4 space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={limits.enabled} className="accent-bronze" />
        <span className="font-medium text-espresso">Try-on enabled for customers</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {num("per_user_daily", "Per customer per day", "0 disables new jobs")}
        {num("site_daily", "Site-wide per day", "all customers together")}
        {num("daily_credit_cap", "Daily credit cap", "new jobs stop when reached")}
        {num("alert_threshold_pct", "Alert at % of cap", "banner on this page")}
        {num("retention_hours", "Keep photos (hours)", "1–168; then purged")}
        {num("max_attempts", "Attempts per job", "retries on provider errors")}
      </div>
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm text-cream disabled:opacity-60">Save limits</button>
    </form>
  );
}

export function GarmentForm({ productId, current }: { productId: string; current: { storage_path: string; alt: string } | null }) {
  const [state, action, pending] = useActionState<GarmentState, FormData>(setTryonGarment.bind(null, productId), { ok: false, message: null });
  return (
    <form action={action} aria-label="Try-on garment photo" className="space-y-3 text-sm">
      {current ? (
        <p className="text-muted">Current reference: <code className="text-xs">{current.storage_path}</code> ({current.alt})</p>
      ) : (
        <p className="text-muted">No garment reference yet, so try-on is hidden for this product.</p>
      )}
      <label className="block">
        <span className="font-medium text-espresso">Garment photo (flat-lay or on a model, plain background)</span>
        <input name="garment" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-espresso file:px-3 file:py-1.5 file:text-cream" />
      </label>
      <label className="block">
        <span className="font-medium text-espresso">Alt text</span>
        <input name="alt" defaultValue={current?.alt ?? ""} minLength={3} maxLength={200} required className={`mt-1 ${inputCls}`} />
      </label>
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-cream disabled:opacity-60">
        {pending ? "Uploading…" : "Save garment photo and enable try-on"}
      </button>
      <p className="text-xs text-muted">Uploads go to the public product-media bucket (the photo is shown to the AI provider and may be shown on the product page). Only upload photos you have the rights to.</p>
    </form>
  );
}
