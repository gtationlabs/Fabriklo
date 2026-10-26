"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/admin/(console)/products/actions";
import { formatBDT } from "@/lib/money";
import { Field, FormMessage, inputCls } from "./form-bits";

type Bound = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const idle: ActionState = { ok: false, message: null, errors: {} };

export type VariantRowData = {
  id: string;
  sku: string;
  size: string;
  color: string;
  color_hex: string | null;
  price_minor: number;
  compare_at_minor: number | null;
  is_active: boolean;
  cost_minor: number | null;
  stock: { warehouse_id: string; warehouse: string; on_hand: number; reserved: number }[];
};

export function AddVariantForm({ action, canCost }: { action: Bound; canCost: boolean }) {
  const [state, formAction, pending] = useActionState(action, idle);
  const e = state.errors;
  const val = (n: string) => (state.ok ? "" : (state.values?.[n] ?? ""));
  return (
    <form key={JSON.stringify(state.values ?? {}) + String(state.ok)} action={formAction} className="grid gap-3 rounded border border-line bg-white p-4 md:grid-cols-4" noValidate>
      <Field label="SKU" name="sku" errors={e}>
        <input id="sku" name="sku" defaultValue={val("sku")} required className={inputCls} placeholder="TEE-BLK-M" />
      </Field>
      <Field label="Size" name="size" errors={e}>
        <input id="size" name="size" defaultValue={val("size")} required className={inputCls} placeholder="M" />
      </Field>
      <Field label="Colour" name="color" errors={e}>
        <input id="color" name="color" defaultValue={val("color")} required className={inputCls} placeholder="Black" />
      </Field>
      <Field label="Colour hex" name="color_hex" errors={e}>
        <input id="color_hex" name="color_hex" defaultValue={val("color_hex")} className={inputCls} placeholder="#111111" />
      </Field>
      <Field label="Price (৳)" name="price" errors={e}>
        <input id="price" name="price" defaultValue={val("price")} inputMode="decimal" required className={inputCls} placeholder="1290" />
      </Field>
      <Field label="Compare-at (৳)" name="compare_at" errors={e}>
        <input id="compare_at" name="compare_at" defaultValue={val("compare_at")} inputMode="decimal" className={inputCls} />
      </Field>
      {canCost ? (
        <Field label="Cost (৳, private)" name="cost" errors={e}>
          <input id="cost" name="cost" defaultValue={val("cost")} inputMode="decimal" className={inputCls} />
        </Field>
      ) : null}
      <div className="flex items-end gap-3 md:col-span-4">
        <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">
          {pending ? "Adding…" : "Add variant"}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function VariantRow({
  v,
  updateAction,
  adjustAction,
  canAdjust,
  warehouses,
  newIdempotencyKey,
}: {
  v: VariantRowData;
  updateAction: Bound;
  adjustAction: Bound;
  canAdjust: boolean;
  warehouses: { id: string; name: string }[];
  newIdempotencyKey: string;
}) {
  const [upd, updAction, updPending] = useActionState(updateAction, idle);
  const [adj, adjAction, adjPending] = useActionState(adjustAction, idle);
  const [open, setOpen] = useState(false);
  const onHand = v.stock.reduce((s, b) => s + b.on_hand, 0);
  const reserved = v.stock.reduce((s, b) => s + b.reserved, 0);

  return (
    <tr className="align-top" data-testid={`variant-${v.sku}`}>
      <td className="py-3 pr-3">
        <span className="font-mono text-xs">{v.sku}</span>
        <div className="flex items-center gap-2 text-sm">
          <span className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: v.color_hex ?? "#ccc" }} aria-hidden />
          {v.color} · {v.size}
        </div>
        {v.cost_minor != null ? <p className="text-xs text-muted">Cost {formatBDT(v.cost_minor)}</p> : null}
      </td>
      <td className="py-3 pr-3">
        <form action={updAction} className="flex flex-wrap items-center gap-2" noValidate>
          <label className="text-xs">
            <span className="sr-only">Price for {v.sku}</span>
            <input name="price" defaultValue={v.price_minor / 100} inputMode="decimal" className={`${inputCls} w-24`} aria-label={`Price for ${v.sku}`} />
          </label>
          <label className="text-xs">
            <span className="sr-only">Compare-at for {v.sku}</span>
            <input name="compare_at" defaultValue={v.compare_at_minor != null ? v.compare_at_minor / 100 : ""} placeholder="Compare" inputMode="decimal" className={`${inputCls} w-24`} aria-label={`Compare-at price for ${v.sku}`} />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="is_active" defaultChecked={v.is_active} className="accent-bronze" /> Active
          </label>
          <button disabled={updPending} className="rounded border border-line px-2 py-1 text-xs">Save</button>
          <div className="w-full">
            <FormMessage state={{ ...upd, message: upd.message ?? (Object.values(upd.errors)[0] || null) }} />
          </div>
        </form>
      </td>
      <td className="py-3 pr-3 text-sm" data-testid={`stock-${v.sku}`}>
        <span className="font-semibold">{onHand - reserved}</span> available
        <p className="text-xs text-muted">
          {onHand} on hand · {reserved} reserved
        </p>
      </td>
      <td className="py-3">
        {canAdjust ? (
          <>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded border border-line px-2 py-1 text-xs">
              Adjust stock
            </button>
            {open ? (
              <form action={adjAction} className="mt-2 grid w-64 gap-2 rounded border border-line bg-cream p-3" noValidate>
                <input type="hidden" name="idempotency_key" value={newIdempotencyKey} />
                <label className="text-xs">
                  Location
                  <select name="warehouse_id" className={inputCls}>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  Type
                  <select name="movement_type" className={inputCls}>
                    <option value="receive">Receive (+)</option>
                    <option value="adjust">Adjust (+/−)</option>
                    <option value="damage">Damaged (−)</option>
                    <option value="return">Customer return (+)</option>
                  </select>
                </label>
                <label className="text-xs">
                  Quantity (use − to remove)
                  <input name="delta" inputMode="numeric" className={inputCls} />
                </label>
                <label className="text-xs">
                  Reason (required, audited)
                  <input name="reason" className={inputCls} />
                </label>
                <button disabled={adjPending} className="rounded bg-espresso px-3 py-1.5 text-xs text-cream">
                  {adjPending ? "Saving…" : "Apply"}
                </button>
                <FormMessage state={{ ...adj, message: adj.message ?? (Object.values(adj.errors)[0] || null) }} />
              </form>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-muted">No stock permission</span>
        )}
      </td>
    </tr>
  );
}
