"use client";

import { useActionState } from "react";
import { saveAddress, updateProfile, type AccountState } from "@/app/(shop)/account/actions";
import { Message, input } from "@/components/account/auth-forms";
import type { Address, Customer } from "@/lib/account/session";

const idle: AccountState = { ok: false, message: null };
const btn = "rounded bg-espresso px-5 py-2.5 text-sm font-medium text-cream hover:bg-charcoal disabled:opacity-60";

export function ProfileForm({ customer }: { customer: Customer }) {
  const [state, action, pending] = useActionState(updateProfile, idle);
  const v = state.values ?? { full_name: customer.fullName, phone: customer.phone ?? "" };
  return (
    <form action={action} key={JSON.stringify(customer) + String(state.ok)} className="space-y-4" aria-label="Your details">
      <Message state={state} />
      <label className="block text-sm font-medium">Full name<input name="full_name" defaultValue={v.full_name} required maxLength={120} className={input} /></label>
      <label className="block text-sm font-medium">Mobile number<input name="phone" type="tel" defaultValue={v.phone} placeholder="01XXXXXXXXX" className={input} /></label>
      <p className="text-sm text-muted">Email: {customer.email}</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="marketing_opt_in" defaultChecked={customer.marketingOptIn} /> Send me news and offers</label>
      <button type="submit" disabled={pending} className={btn}>Save details</button>
    </form>
  );
}

export function AddressForm({ address, divisions, onDone }: { address?: Address; divisions: Record<string, readonly string[]>; onDone?: () => void }) {
  const [state, action, pending] = useActionState(saveAddress, idle);
  const v = state.values ?? {
    label: address?.label ?? "Home",
    recipient_name: address?.recipient_name ?? "",
    phone: address?.phone ?? "",
    district: address?.district ?? "",
    area: address?.area ?? "",
    address_line: address?.address_line ?? "",
    postal_code: address?.postal_code ?? "",
  };
  if (state.ok && onDone) onDone();
  return (
    <form action={action} key={String(state.ok)} className="grid gap-3 rounded border border-line bg-cream p-4 sm:grid-cols-2" aria-label={address ? `Edit ${address.label}` : "New address"}>
      {address ? <input type="hidden" name="id" value={address.id} /> : null}
      <div className="sm:col-span-2"><Message state={state} /></div>
      <label className="text-sm font-medium">Label<input name="label" defaultValue={v.label} maxLength={40} required className={input} /></label>
      <label className="text-sm font-medium">Recipient name<input name="recipient_name" defaultValue={v.recipient_name} required maxLength={120} className={input} /></label>
      <label className="text-sm font-medium">Mobile number<input name="phone" type="tel" defaultValue={v.phone} required className={input} /></label>
      <label className="text-sm font-medium">District
        <select name="district" defaultValue={v.district} required className={input}>
          <option value="">Choose district</option>
          {Object.entries(divisions).map(([div, ds]) => (
            <optgroup key={div} label={`${div} division`}>{ds.map((d) => <option key={d} value={d}>{d}</option>)}</optgroup>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">Area / thana<input name="area" defaultValue={v.area} required maxLength={80} className={input} /></label>
      <label className="text-sm font-medium">Postcode (optional)<input name="postal_code" defaultValue={v.postal_code} inputMode="numeric" maxLength={4} className={input} /></label>
      <label className="text-sm font-medium sm:col-span-2">House, road, landmark<textarea name="address_line" defaultValue={v.address_line} rows={2} required maxLength={300} className={input} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_default" defaultChecked={address?.is_default ?? false} /> Use as default</label>
      <div className="flex justify-end"><button type="submit" disabled={pending} className={btn}>{pending ? "Saving…" : "Save address"}</button></div>
    </form>
  );
}
