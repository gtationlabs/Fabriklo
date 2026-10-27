"use client";

import { useActionState } from "react";
import { confirmRates, saveCod, saveContact, saveIdentity, saveOnline, saveZone, type SettingsActionState } from "@/app/admin/(console)/settings/actions";
import { FormMessage, inputCls } from "@/components/admin/form-bits";
import { BD_DIVISIONS } from "@/lib/geo/bd";

const idle: SettingsActionState = { ok: false, message: null };
const taka = (minor: number | null | undefined) => (minor == null ? "" : (minor / 100).toFixed(minor % 100 ? 2 : 0));

export function IdentityForm({ identity }: { identity: { name: string; tagline: string; locale: string } }) {
  const [state, action, pending] = useActionState(saveIdentity, idle);
  const v = state.values ?? identity;
  return (
    <form action={action} aria-label="Store identity" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-1">
          <span className="block font-medium">Store name</span>
          <input name="name" required minLength={2} maxLength={60} defaultValue={v.name} className={inputCls} />
          <span className="text-xs text-muted">Shown in the header, footer and page titles. Not confirmed by the owner yet.</span>
        </label>
        <label className="text-sm sm:col-span-1">
          <span className="block font-medium">Tagline</span>
          <input name="tagline" maxLength={120} defaultValue={v.tagline} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Locale</span>
          <select name="locale" defaultValue={v.locale} className={inputCls}>
            <option value="en-BD">English (Bangladesh)</option>
            <option value="bn-BD">Bangla (Bangladesh)</option>
          </select>
          <span className="text-xs text-muted">Currency is fixed to BDT.</span>
        </label>
      </div>
      <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">Save identity</button>
      <FormMessage state={state} />
    </form>
  );
}

export function ContactForm({ contact }: { contact: { email: string; phone: string; address: string; hours: string; note: string } }) {
  const [state, action, pending] = useActionState(saveContact, idle);
  const v = state.values ?? contact;
  return (
    <form action={action} aria-label="Store contact" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="block font-medium">Contact email</span><input name="email" type="email" required maxLength={120} defaultValue={v.email} className={inputCls} /></label>
        <label className="text-sm"><span className="block font-medium">Phone (+8801…)</span><input name="phone" required pattern="\+8801[3-9][0-9]{8}" defaultValue={v.phone} className={inputCls} /></label>
        <label className="text-sm sm:col-span-2"><span className="block font-medium">Address</span><input name="address" maxLength={200} defaultValue={v.address} className={inputCls} /></label>
        <label className="text-sm"><span className="block font-medium">Opening hours</span><input name="hours" maxLength={120} defaultValue={v.hours} className={inputCls} /></label>
        <label className="text-sm"><span className="block font-medium">Note (internal)</span><input name="note" maxLength={200} defaultValue={v.note} className={inputCls} /></label>
      </div>
      <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">Save contact</button>
      <FormMessage state={state} />
    </form>
  );
}

export function CodForm({ cod }: { cod: { enabled: boolean; max_order_minor: number } }) {
  const [state, action, pending] = useActionState(saveCod, idle);
  return (
    <form action={action} aria-label="Cash on delivery" className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={state.values ? state.values.enabled === "on" : cod.enabled} /> Offer cash on delivery</label>
      <label className="block max-w-xs text-sm">
        <span className="block font-medium">Maximum order for cash on delivery (৳)</span>
        <input name="max_order_taka" inputMode="decimal" required defaultValue={state.values?.max_order_taka ?? taka(cod.max_order_minor)} className={inputCls} />
        <span className="text-xs text-muted">Orders above this must be paid online. Stored as an integer in poisha.</span>
      </label>
      <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">Save cash on delivery</button>
      <FormMessage state={state} />
    </form>
  );
}

export function OnlineForm({ online }: { online: { enabled: boolean; hold_minutes: number } }) {
  const [state, action, pending] = useActionState(saveOnline, idle);
  return (
    <form action={action} aria-label="Online payment" className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={state.values ? state.values.enabled === "on" : online.enabled} /> Offer online payment (SSLCOMMERZ)</label>
      <label className="block max-w-xs text-sm">
        <span className="block font-medium">Hold stock while paying (minutes)</span>
        <input name="hold_minutes" type="number" min={5} max={120} required defaultValue={state.values?.hold_minutes ?? online.hold_minutes} className={inputCls} />
      </label>
      <p className="text-xs text-muted">Gateway credentials live in the server secret store (see .env.example), never here.</p>
      <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">Save online payment</button>
      <FormMessage state={state} />
    </form>
  );
}

export function RatesConfirmForm({ confirmed }: { confirmed: boolean }) {
  const [state, action, pending] = useActionState(confirmRates, idle);
  return (
    <form action={action} aria-label="Rates status" className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" name="rates_confirmed" defaultChecked={confirmed} /> The delivery fees and COD limit above are the real ones (not demo values)</label>
      <button type="submit" disabled={pending} className="rounded border border-line px-3 py-1">Update</button>
      <FormMessage state={state} />
    </form>
  );
}

export type ZoneRow = {
  id: string;
  code: string;
  name: string;
  districts: string[];
  is_fallback: boolean;
  fee_minor: number;
  free_over_minor: number | null;
  cod_enabled: boolean;
  estimate_min_days: number;
  estimate_max_days: number;
  is_active: boolean;
};

export function ZoneForm({ zone, takenDistricts }: { zone: ZoneRow | null; takenDistricts: Map<string, string> }) {
  const [state, action, pending] = useActionState(saveZone, idle);
  const v = state.values;
  const label = zone ? `Zone: ${zone.name}` : "New zone";
  const selected = new Set(zone?.districts ?? []);
  return (
    <form action={action} aria-label={label} key={state.ok ? "saved" : "editing"} className="space-y-3 rounded-lg border border-line bg-white p-4" data-testid="zone-form">
      <input type="hidden" name="id" value={zone?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="block font-medium">Code</span>
          <input name="code" required pattern="[a-z0-9_-]{2,40}" defaultValue={v?.code ?? zone?.code ?? ""} readOnly={Boolean(zone)} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Name</span>
          <input name="name" required minLength={2} maxLength={80} defaultValue={v?.name ?? zone?.name ?? ""} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Delivery fee (৳)</span>
          <input name="fee_taka" inputMode="decimal" required defaultValue={v?.fee_taka ?? taka(zone?.fee_minor ?? 0)} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Free delivery over (৳, optional)</span>
          <input name="free_over_taka" inputMode="decimal" defaultValue={v?.free_over_taka ?? taka(zone?.free_over_minor)} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Estimate (min days)</span>
          <input name="estimate_min_days" type="number" min={0} max={60} required defaultValue={v?.estimate_min_days ?? zone?.estimate_min_days ?? 1} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Estimate (max days)</span>
          <input name="estimate_max_days" type="number" min={0} max={60} required defaultValue={v?.estimate_max_days ?? zone?.estimate_max_days ?? 3} className={inputCls} />
        </label>
        <div className="space-y-1 text-sm sm:col-span-2">
          <label className="flex items-center gap-2"><input type="checkbox" name="cod_enabled" defaultChecked={v ? v.cod_enabled === "on" : zone?.cod_enabled ?? true} /> Cash on delivery available</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="is_fallback" defaultChecked={v ? v.is_fallback === "on" : zone?.is_fallback ?? false} /> Fallback zone (any district not listed elsewhere)</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={v ? v.is_active === "on" : zone?.is_active ?? true} /> Active</label>
        </div>
      </div>
      <details open={!zone || undefined}>
        <summary className="cursor-pointer text-sm font-medium">Districts ({selected.size} selected)</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(BD_DIVISIONS).map(([division, districts]) => (
            <fieldset key={division} className="text-xs">
              <legend className="font-semibold">{division}</legend>
              {districts.map((d) => {
                const owner = takenDistricts.get(d);
                const elsewhere = owner && owner !== zone?.code;
                return (
                  <label key={d} className={`flex items-center gap-1 ${elsewhere ? "text-muted" : ""}`} title={elsewhere ? `Already in zone ${owner}` : undefined}>
                    <input type="checkbox" name="districts" value={d} defaultChecked={selected.has(d)} /> {d}
                    {elsewhere ? <span className="sr-only"> (already in another zone)</span> : null}
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>
      </details>
      <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">{zone ? "Save zone" : "Create zone"}</button>
      <FormMessage state={state} />
    </form>
  );
}
