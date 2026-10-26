"use client";

import { useActionState } from "react";
import { addNote, flagOrder, saveShipment, transitionOrder, type OrderActionState } from "@/app/admin/(console)/orders/actions";
import { FormMessage, inputCls } from "@/components/admin/form-bits";
import { label, NEEDS_REASON } from "@/lib/orders/labels";

const idle: OrderActionState = { ok: false, message: null };
const btn = "rounded bg-espresso px-3 py-2 text-sm text-cream hover:bg-charcoal disabled:opacity-60";

export function TransitionForm({
  orderId,
  field,
  title,
  current,
  options,
}: {
  orderId: string;
  field: string;
  title: string;
  current: string;
  options: string[];
}) {
  const [state, action, pending] = useActionState(transitionOrder, idle);
  const v = state.values ?? {};
  const id = `t-${field}`;
  return (
    <form action={action} key={`${current}-${state.ok}`} className="space-y-2 rounded border border-line bg-white p-4" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="text-sm font-semibold text-espresso">
        {title}: <span className="font-normal">{label(current)}</span>
      </h3>
      {options.length === 0 ? (
        <p className="text-xs text-muted">No further changes from here.</p>
      ) : (
        <>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="field" value={field} />
          <label htmlFor={`${id}-to`} className="sr-only">New {title.toLowerCase()}</label>
          <select id={`${id}-to`} name="to" defaultValue={v.to ?? options[0]} className={inputCls}>
            {options.map((o) => (
              <option key={o} value={o}>
                {label(o)}{NEEDS_REASON.has(o) ? " (reason needed)" : ""}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-reason`} className="sr-only">Reason</label>
          <input id={`${id}-reason`} name="reason" defaultValue={v.reason ?? ""} placeholder="Reason or note (optional unless marked)" maxLength={500} className={inputCls} />
          <button type="submit" disabled={pending} className={btn}>
            {pending ? "Saving…" : "Update"}
          </button>
        </>
      )}
      <FormMessage state={state} />
    </form>
  );
}

export function ShipmentForm({
  orderId,
  shipment,
}: {
  orderId: string;
  shipment: { courier: string; courier_name: string | null; tracking_number: string | null; tracking_url: string | null } | null;
}) {
  const [state, action, pending] = useActionState(saveShipment, idle);
  const v = state.values ?? {
    courier: shipment?.courier ?? "manual",
    courierName: shipment?.courier_name ?? "",
    trackingNumber: shipment?.tracking_number ?? "",
    trackingUrl: shipment?.tracking_url ?? "",
  };
  return (
    <form action={action} key={JSON.stringify(shipment) + state.ok} aria-label="Courier and tracking" className="grid gap-2 rounded border border-line bg-white p-4 sm:grid-cols-2">
      <h3 className="text-sm font-semibold text-espresso sm:col-span-2">Courier & tracking (entered by hand)</h3>
      <input type="hidden" name="orderId" value={orderId} />
      <label className="text-xs">
        Courier
        <select name="courier" defaultValue={v.courier} className={inputCls}>
          <option value="manual">Own delivery / manual</option>
          <option value="pathao">Pathao</option>
          <option value="steadfast">Steadfast</option>
          <option value="redx">RedX</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="text-xs">
        Display name
        <input name="courierName" defaultValue={v.courierName} maxLength={60} className={inputCls} />
      </label>
      <label className="text-xs">
        Tracking number
        <input name="trackingNumber" defaultValue={v.trackingNumber} maxLength={60} className={inputCls} />
      </label>
      <label className="text-xs">
        Tracking link (https)
        <input name="trackingUrl" type="url" defaultValue={v.trackingUrl} maxLength={300} className={inputCls} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={btn}>{pending ? "Saving…" : "Save shipment"}</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function NoteForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(addNote, idle);
  return (
    <form action={action} key={String(state.ok) + (state.message ?? "")} className="space-y-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor="note-body" className="text-sm font-medium">Internal note</label>
      <textarea id="note-body" name="body" rows={2} maxLength={2000} defaultValue={state.values?.body ?? ""} className={inputCls} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>Add note</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function FlagForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(flagOrder, idle);
  return (
    <form action={action} key={String(state.ok)} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <label className="flex-1 text-xs">
        Send to risk review: reason
        <input name="reason" defaultValue={state.values?.reason ?? ""} maxLength={300} className={inputCls} />
      </label>
      <button type="submit" disabled={pending} className="rounded border border-line px-3 py-2 text-sm">Flag</button>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}
