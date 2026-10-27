"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { friendlyDbError } from "@/lib/db-errors";
import { parseTakaToMinor } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Purchase orders and stock transfers. Documents are edited as drafts and
 * then moved through their states by RPCs; every stock change happens inside
 * the database through the same locked, idempotent movement primitive as a
 * manual adjustment. Actions re-check the permission + MFA on the server.
 */
export type DocState = { ok: boolean; message: string | null; values?: Record<string, string> };
const uuid = z.uuid();

const lineSchema = z.object({
  variant_id: z.uuid(),
  quantity: z.number().int().min(1).max(100000),
  unit_cost: z.string().trim().max(20).optional(),
});

function parseLines(raw: FormDataEntryValue | null): { ok: true; lines: { variant_id: string; quantity: number; unit_cost_minor: number | null }[] } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch {
    return { ok: false, message: "Lines are malformed." };
  }
  const res = z.array(lineSchema).min(1, "Add at least one line.").max(200).safeParse(parsed);
  if (!res.success) return { ok: false, message: res.error.issues[0]?.message ?? "Check the lines." };
  const lines = [];
  for (const l of res.data) {
    let unit_cost_minor: number | null = null;
    if (l.unit_cost && l.unit_cost !== "") {
      unit_cost_minor = parseTakaToMinor(l.unit_cost);
      if (unit_cost_minor == null) return { ok: false, message: "Unit cost must be an amount in taka." };
    }
    lines.push({ variant_id: l.variant_id, quantity: l.quantity, unit_cost_minor });
  }
  if (new Set(lines.map((l) => l.variant_id)).size !== lines.length) return { ok: false, message: "A variant appears twice." };
  return { ok: true, lines };
}

export type VariantHit = { variant_id: string; sku: string; size: string; color: string; product_title: string; product_status: string };

/** Live search for the line editor (inventory.read). */
export async function searchVariants(query: string): Promise<VariantHit[]> {
  const auth = await checkStaff("inventory.read");
  if (!auth.ok) return [];
  const q = String(query ?? "").slice(0, 40);
  if (q.trim().length < 1) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_variant_search", { p_query: q, p_limit: 15 });
  return (data ?? []) as VariantHit[];
}

export async function savePurchaseOrder(id: string | null, _prev: DocState, fd: FormData): Promise<DocState> {
  const auth = await checkStaff("inventory.adjust");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (id && !uuid.safeParse(id).success) return { ok: false, message: "Unknown purchase order." };
  const lines = parseLines(fd.get("lines"));
  if (!lines.ok) return { ok: false, message: lines.message };
  const supplier = String(fd.get("supplier_name") ?? "").trim();
  if (supplier.length < 2 || supplier.length > 120) return { ok: false, message: "Supplier name must be 2–120 characters." };
  const warehouse = String(fd.get("warehouse_id") ?? "");
  if (!uuid.safeParse(warehouse).success) return { ok: false, message: "Choose a warehouse." };
  const expected = String(fd.get("expected_at") ?? "").trim();
  if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) return { ok: false, message: "Expected date must be a date." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_po_save", {
    p: {
      id,
      supplier_name: supplier,
      supplier_ref: String(fd.get("supplier_ref") ?? "").trim().slice(0, 80),
      warehouse_id: warehouse,
      expected_at: expected || null,
      note: String(fd.get("note") ?? "").trim().slice(0, 1000),
      lines: lines.lines,
    },
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  const saved = data as { id: string; number: string };
  revalidatePath("/admin/inventory/purchase-orders");
  revalidatePath(`/admin/inventory/purchase-orders/${saved.id}`);
  if (!id) redirect(`/admin/inventory/purchase-orders/${saved.id}?saved=1`);
  return { ok: true, message: "Draft saved." };
}

export async function setPurchaseOrderStatus(id: string, status: "ordered" | "cancelled", _prev: DocState, fd: FormData): Promise<DocState> {
  const auth = await checkStaff("inventory.adjust");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!uuid.safeParse(id).success) return { ok: false, message: "Unknown purchase order." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_po_set_status", { p_id: id, p_status: status, p_reason: String(fd.get("reason") ?? "").trim().slice(0, 500) || null });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/admin/inventory/purchase-orders");
  revalidatePath(`/admin/inventory/purchase-orders/${id}`);
  return { ok: true, message: status === "ordered" ? "Marked as ordered. Receive stock when it arrives." : "Purchase order cancelled." };
}

export async function receivePurchaseOrder(id: string, _prev: DocState, fd: FormData): Promise<DocState> {
  const auth = await checkStaff("inventory.adjust");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!uuid.safeParse(id).success) return { ok: false, message: "Unknown purchase order." };
  const key = String(fd.get("idempotency_key") ?? "");
  if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) return { ok: false, message: "Missing idempotency key; reload the page." };
  const lines: { line_id: string; quantity: number }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = /^qty_([0-9a-f-]{36})$/.exec(k);
    if (!m) continue;
    const qty = Number(v);
    if (!Number.isInteger(qty) || qty < 0 || qty > 100000) return { ok: false, message: "Quantities must be whole numbers." };
    if (qty > 0) lines.push({ line_id: m[1], quantity: qty });
  }
  if (!lines.length) return { ok: false, message: "Enter the quantities that arrived." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_po_receive", { p_id: id, p_lines: lines, p_idempotency_key: key });
  if (error) return { ok: false, message: error.hint === "over_receive" ? "You cannot receive more than was ordered on a line." : friendlyDbError(error) };
  const r = data as { received_units: number; status: string };
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/purchase-orders");
  revalidatePath(`/admin/inventory/purchase-orders/${id}`);
  return { ok: true, message: `${r.received_units} unit${r.received_units === 1 ? "" : "s"} received into stock${r.status === "received" ? "; purchase order complete." : "."}` };
}

export async function saveTransfer(id: string | null, _prev: DocState, fd: FormData): Promise<DocState> {
  const auth = await checkStaff("inventory.adjust");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (id && !uuid.safeParse(id).success) return { ok: false, message: "Unknown transfer." };
  const lines = parseLines(fd.get("lines"));
  if (!lines.ok) return { ok: false, message: lines.message };
  const from = String(fd.get("from_warehouse_id") ?? "");
  const to = String(fd.get("to_warehouse_id") ?? "");
  if (!uuid.safeParse(from).success || !uuid.safeParse(to).success) return { ok: false, message: "Choose both warehouses." };
  if (from === to) return { ok: false, message: "Choose two different warehouses." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_transfer_save", {
    p: { id, from_warehouse_id: from, to_warehouse_id: to, note: String(fd.get("note") ?? "").trim().slice(0, 1000), lines: lines.lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })) },
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  const saved = data as { id: string; number: string };
  revalidatePath("/admin/inventory/transfers");
  revalidatePath(`/admin/inventory/transfers/${saved.id}`);
  if (!id) redirect(`/admin/inventory/transfers/${saved.id}?saved=1`);
  return { ok: true, message: "Draft saved." };
}

export async function setTransferStatus(id: string, status: "sent" | "received" | "cancelled", _prev: DocState, fd: FormData): Promise<DocState> {
  const auth = await checkStaff("inventory.adjust");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!uuid.safeParse(id).success) return { ok: false, message: "Unknown transfer." };
  const key = String(fd.get("idempotency_key") ?? "");
  if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) return { ok: false, message: "Missing idempotency key; reload the page." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_transfer_set_status", { p_id: id, p_status: status, p_idempotency_key: key, p_reason: String(fd.get("reason") ?? "").trim().slice(0, 500) || null });
  if (error) {
    if (error.code === "P0001") return { ok: false, message: "The source warehouse does not have enough available stock for one of the lines." };
    return { ok: false, message: friendlyDbError(error) };
  }
  const r = data as { status: string; units: number };
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/transfers");
  revalidatePath(`/admin/inventory/transfers/${id}`);
  const msg = { sent: `Sent: ${r.units} units left the source warehouse.`, received: `Received: ${r.units} units added at the destination.`, cancelled: r.units ? `Cancelled: ${r.units} units returned to the source warehouse.` : "Transfer cancelled." }[status];
  return { ok: true, message: msg };
}
