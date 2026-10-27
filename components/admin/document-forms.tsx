"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { receivePurchaseOrder, savePurchaseOrder, saveTransfer, searchVariants, type DocState, type VariantHit } from "@/app/admin/(console)/inventory/documents/actions";
import { formatBDT } from "@/lib/money";
import { FormMessage, inputCls } from "./form-bits";

const idle: DocState = { ok: false, message: null };

export type LineDraft = { variant_id: string; sku: string; label: string; quantity: number; unit_cost: string };
export type Warehouse = { id: string; name: string };

/* ----------------------------------------------------------------------------
 * Line editor: search a SKU or product, add it, set quantity (and cost for
 * purchase orders). Serialised into a hidden `lines` field for the action.
 * -------------------------------------------------------------------------- */
export function LinesEditor({ initial, withCost, canCost }: { initial: LineDraft[]; withCost: boolean; canCost: boolean }) {
  const [lines, setLines] = useState<LineDraft[]>(initial);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VariantHit[]>([]);
  const [searching, setSearching] = useState(false);
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setHits(await searchVariants(value));
      } finally {
        setSearching(false);
      }
    }, 200);
  };

  const add = (h: VariantHit) => {
    if (lines.some((l) => l.variant_id === h.variant_id)) return;
    setLines([...lines, { variant_id: h.variant_id, sku: h.sku, label: `${h.product_title} (${h.color} / ${h.size})`, quantity: 1, unit_cost: "" }]);
    setQuery("");
    setHits([]);
  };
  const update = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => setLines(lines.filter((_, j) => j !== i));

  return (
    <div className="space-y-3" data-testid="lines-editor">
      <input type="hidden" name="lines" value={JSON.stringify(lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_cost: withCost && canCost ? l.unit_cost : undefined })))} />
      <div className="relative">
        <label className="block text-sm font-medium text-espresso" htmlFor={`${listId}-search`}>Add a SKU</label>
        <input id={`${listId}-search`} value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Search by SKU or product name" className={`mt-1 ${inputCls}`} autoComplete="off" aria-controls={`${listId}-results`} />
        {hits.length > 0 || searching ? (
          <ul id={`${listId}-results`} className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded border border-line bg-white shadow" role="listbox" aria-label="Matching SKUs">
            {searching && hits.length === 0 ? <li className="px-3 py-2 text-sm text-muted">Searching…</li> : null}
            {hits.map((h) => (
              <li key={h.variant_id}>
                <button type="button" onClick={() => add(h)} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-cream" role="option" aria-selected={false}>
                  <span>{h.product_title} <span className="text-muted">({h.color} / {h.size})</span>{h.product_status !== "active" ? <span className="ml-1 text-xs text-muted">[{h.product_status}]</span> : null}</span>
                  <span className="font-mono text-xs">{h.sku}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">No lines yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Lines</caption>
          <thead className="text-xs uppercase tracking-wider text-muted">
            <tr>
              <th scope="col" className="py-2 pr-3">SKU</th>
              <th scope="col" className="py-2 pr-3">Item</th>
              <th scope="col" className="py-2 pr-3">Quantity</th>
              {withCost && canCost ? <th scope="col" className="py-2 pr-3">Unit cost (৳)</th> : null}
              <th scope="col" className="py-2"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => (
              <tr key={l.variant_id} data-testid="line-row">
                <td className="py-2 pr-3 font-mono text-xs">{l.sku}</td>
                <td className="py-2 pr-3">{l.label}</td>
                <td className="py-2 pr-3">
                  <input type="number" min={1} max={100000} value={l.quantity} onChange={(e) => update(i, { quantity: Math.max(1, Math.min(100000, Number(e.target.value) || 1)) })} className={`${inputCls} w-24`} aria-label={`Quantity for ${l.sku}`} />
                </td>
                {withCost && canCost ? (
                  <td className="py-2 pr-3">
                    <input inputMode="decimal" value={l.unit_cost} onChange={(e) => update(i, { unit_cost: e.target.value })} className={`${inputCls} w-28`} aria-label={`Unit cost for ${l.sku}`} placeholder="optional" />
                  </td>
                ) : null}
                <td className="py-2">
                  <button type="button" onClick={() => remove(i)} className="text-xs text-danger underline" aria-label={`Remove ${l.sku}`}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Purchase order
 * -------------------------------------------------------------------------- */
export type PurchaseOrderDraft = { id: string | null; supplier_name: string; supplier_ref: string; warehouse_id: string; expected_at: string; note: string; lines: LineDraft[] };

export function PurchaseOrderForm({ draft, warehouses, canCost }: { draft: PurchaseOrderDraft; warehouses: Warehouse[]; canCost: boolean }) {
  const [state, action, pending] = useActionState<DocState, FormData>(savePurchaseOrder.bind(null, draft.id), idle);
  return (
    <form action={action} aria-label={draft.id ? "Edit purchase order" : "New purchase order"} className="space-y-5 rounded border border-line bg-white p-5" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm"><span className="font-medium text-espresso">Supplier</span><input name="supplier_name" defaultValue={draft.supplier_name} required maxLength={120} className={`mt-1 ${inputCls}`} /></label>
        <label className="block text-sm"><span className="font-medium text-espresso">Supplier reference</span><input name="supplier_ref" defaultValue={draft.supplier_ref} maxLength={80} className={`mt-1 ${inputCls}`} /></label>
        <label className="block text-sm">
          <span className="font-medium text-espresso">Deliver to warehouse</span>
          <select name="warehouse_id" defaultValue={draft.warehouse_id || warehouses[0]?.id || ""} className={`mt-1 ${inputCls}`}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="block text-sm"><span className="font-medium text-espresso">Expected on</span><input name="expected_at" type="date" defaultValue={draft.expected_at} className={`mt-1 ${inputCls}`} /></label>
        <label className="block text-sm md:col-span-2"><span className="font-medium text-espresso">Note</span><textarea name="note" defaultValue={draft.note} maxLength={1000} rows={2} className={`mt-1 ${inputCls}`} /></label>
      </div>
      <LinesEditor initial={draft.lines} withCost canCost={canCost} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">{pending ? "Saving…" : draft.id ? "Save draft" : "Create draft"}</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function StatusForm({ label, confirm, action, reasonLabel, danger, idempotencyKey, testId }: { label: string; confirm?: string; action: (prev: DocState, fd: FormData) => Promise<DocState>; reasonLabel?: string; danger?: boolean; idempotencyKey?: string; testId?: string }) {
  const [state, formAction, pending] = useActionState<DocState, FormData>(action, idle);
  return (
    <form
      action={formAction}
      aria-label={label}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {idempotencyKey ? <input type="hidden" name="idempotency_key" value={idempotencyKey} /> : null}
      {reasonLabel ? <input name="reason" placeholder={reasonLabel} maxLength={500} className={`${inputCls} w-56`} aria-label={reasonLabel} /> : null}
      <button type="submit" disabled={pending} data-testid={testId} className={`rounded px-4 py-2 text-sm font-medium disabled:opacity-60 ${danger ? "border border-danger text-danger" : "bg-espresso text-cream"}`}>{pending ? "Working…" : label}</button>
      <FormMessage state={state} />
    </form>
  );
}

export type ReceiveLine = { id: string; sku: string; label: string; quantity_ordered: number; quantity_received: number; unit_cost_minor: number | null };

export function ReceiveForm({ poId, lines, idempotencyKey, canCost }: { poId: string; lines: ReceiveLine[]; idempotencyKey: string; canCost: boolean }) {
  const [state, action, pending] = useActionState<DocState, FormData>(receivePurchaseOrder.bind(null, poId), idle);
  return (
    <form key={state.ok ? state.message : "receive"} action={action} aria-label="Receive stock" className="space-y-3 rounded border border-line bg-white p-5">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Lines to receive</caption>
        <thead className="text-xs uppercase tracking-wider text-muted">
          <tr>
            <th scope="col" className="py-2 pr-3">SKU</th>
            <th scope="col" className="py-2 pr-3">Item</th>
            <th scope="col" className="py-2 pr-3">Ordered</th>
            <th scope="col" className="py-2 pr-3">Received</th>
            {canCost ? <th scope="col" className="py-2 pr-3">Unit cost</th> : null}
            <th scope="col" className="py-2">Arriving now</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {lines.map((l) => {
            const left = l.quantity_ordered - l.quantity_received;
            return (
              <tr key={l.id} data-testid="receive-line">
                <td className="py-2 pr-3 font-mono text-xs">{l.sku}</td>
                <td className="py-2 pr-3">{l.label}</td>
                <td className="py-2 pr-3">{l.quantity_ordered}</td>
                <td className="py-2 pr-3">{l.quantity_received}</td>
                {canCost ? <td className="py-2 pr-3">{l.unit_cost_minor != null ? formatBDT(l.unit_cost_minor) : "—"}</td> : null}
                <td className="py-2">
                  {left > 0 ? <input type="number" name={`qty_${l.id}`} min={0} max={left} defaultValue={left} className={`${inputCls} w-24`} aria-label={`Quantity arriving for ${l.sku}`} /> : <span className="text-success">Complete</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">{pending ? "Receiving…" : "Receive into stock"}</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------------------
 * Transfer
 * -------------------------------------------------------------------------- */
export type TransferDraft = { id: string | null; from_warehouse_id: string; to_warehouse_id: string; note: string; lines: LineDraft[] };

export function TransferForm({ draft, warehouses }: { draft: TransferDraft; warehouses: Warehouse[] }) {
  const [state, action, pending] = useActionState<DocState, FormData>(saveTransfer.bind(null, draft.id), idle);
  return (
    <form action={action} aria-label={draft.id ? "Edit transfer" : "New transfer"} className="space-y-5 rounded border border-line bg-white p-5" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-espresso">From warehouse</span>
          <select name="from_warehouse_id" defaultValue={draft.from_warehouse_id || warehouses[0]?.id || ""} className={`mt-1 ${inputCls}`}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-espresso">To warehouse</span>
          <select name="to_warehouse_id" defaultValue={draft.to_warehouse_id || warehouses[1]?.id || ""} className={`mt-1 ${inputCls}`}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="block text-sm md:col-span-2"><span className="font-medium text-espresso">Note</span><textarea name="note" defaultValue={draft.note} maxLength={1000} rows={2} className={`mt-1 ${inputCls}`} /></label>
      </div>
      <LinesEditor initial={draft.lines} withCost={false} canCost={false} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">{pending ? "Saving…" : draft.id ? "Save draft" : "Create draft"}</button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

