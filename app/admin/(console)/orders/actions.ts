"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkStaff } from "@/lib/auth/staff";
import { friendlyDbError } from "@/lib/db-errors";
import { NEXT_STATES } from "@/lib/orders/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Order mutations. Each re-checks staff + permission + MFA here, validates with
 * Zod, then calls a SECURITY DEFINER RPC that checks the permission again and
 * enforces the state machine. Clients never update orders directly.
 */
export type OrderActionState = { ok: boolean; message: string | null; values?: Record<string, string> };

const uuid = z.uuid();
const FIELDS = ["fulfillment_status", "shipment_status", "payment_status", "risk_review_status"] as const;

const HINT_MESSAGES: Record<string, string> = {
  invalid_transition: "That status change isn't allowed from the current state.",
  risk_review_pending: "This order is waiting for risk review. Approve or verify it first.",
  order_cancelled: "This order is cancelled.",
  already_shipped: "The parcel has already left the store, so it can't be cancelled here.",
  reason_required: "Please give a reason.",
  not_packed: "Pack the order before marking it ready for pickup.",
  not_delivered: "Cash can only be recorded after delivery.",
};

function dbMessage(error: { code?: string; message?: string; hint?: string }) {
  return (error.hint && HINT_MESSAGES[error.hint]) || friendlyDbError(error);
}

function permissionFor(field: string, to: string): Permission {
  if (field === "risk_review_status") return "risk.review";
  if (field === "fulfillment_status" && to === "cancelled") return "orders.cancel";
  return "orders.fulfill";
}

const transitionSchema = z.object({
  orderId: uuid,
  field: z.enum(FIELDS),
  to: z.string().regex(/^[a-z_]{3,40}$/),
  reason: z.string().trim().max(500).optional(),
});

export async function transitionOrder(_prev: OrderActionState, fd: FormData): Promise<OrderActionState> {
  const parsed = transitionSchema.safeParse({
    orderId: fd.get("orderId"),
    field: fd.get("field"),
    to: fd.get("to"),
    reason: fd.get("reason") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Choose a new status." };
  const { orderId, field, to, reason } = parsed.data;
  const values = { to, reason: reason ?? "" };
  if (!Object.values(NEXT_STATES[field] ?? {}).some((list) => list.includes(to))) {
    return { ok: false, message: "Unknown status.", values };
  }
  const auth = await checkStaff(permissionFor(field, to));
  if (!auth.ok) return { ok: false, message: auth.message, values };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_order_transition", {
    p_order_id: orderId,
    p_field: field,
    p_to: to,
    p_reason: reason ?? null,
  });
  if (error) return { ok: false, message: dbMessage(error), values };
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true, message: "Status updated." };
}

const shipmentSchema = z.object({
  orderId: uuid,
  courier: z.enum(["manual", "pathao", "steadfast", "redx", "other"]),
  courierName: z.string().trim().max(60).optional(),
  trackingNumber: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^[A-Za-z0-9-]{3,60}$/.test(v), "Tracking numbers use letters, digits and dashes"),
  trackingUrl: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (/^https:\/\/[A-Za-z0-9.-]+(\/[^\s<>"]*)?$/.test(v) && v.length <= 300), "Use a full https:// link"),
});

export async function saveShipment(_prev: OrderActionState, fd: FormData): Promise<OrderActionState> {
  const raw = {
    orderId: fd.get("orderId"),
    courier: fd.get("courier"),
    courierName: String(fd.get("courierName") ?? "") || undefined,
    trackingNumber: String(fd.get("trackingNumber") ?? "") || undefined,
    trackingUrl: String(fd.get("trackingUrl") ?? "") || undefined,
  };
  const values = {
    courier: String(raw.courier ?? ""),
    courierName: raw.courierName ?? "",
    trackingNumber: raw.trackingNumber ?? "",
    trackingUrl: raw.trackingUrl ?? "",
  };
  const parsed = shipmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the shipment details.", values };
  const auth = await checkStaff("orders.fulfill");
  if (!auth.ok) return { ok: false, message: auth.message, values };
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_shipment", {
    p_order_id: d.orderId,
    p_courier: d.courier,
    p_courier_name: d.courierName ?? "",
    p_tracking_number: d.trackingNumber ?? "",
    p_tracking_url: d.trackingUrl ?? "",
  });
  if (error) return { ok: false, message: dbMessage(error), values };
  revalidatePath(`/admin/orders/${d.orderId}`);
  return { ok: true, message: "Shipment saved." };
}

const noteSchema = z.object({ orderId: uuid, body: z.string().trim().min(1, "Write a note").max(2000) });

export async function addNote(_prev: OrderActionState, fd: FormData): Promise<OrderActionState> {
  const parsed = noteSchema.safeParse({ orderId: fd.get("orderId"), body: fd.get("body") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Write a note." };
  const auth = await checkStaff("orders.read");
  if (!auth.ok) return { ok: false, message: auth.message, values: { body: parsed.data.body } };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("order_notes")
    .insert({ order_id: parsed.data.orderId, body: parsed.data.body, author_id: auth.staff.userId });
  if (error) return { ok: false, message: dbMessage(error), values: { body: parsed.data.body } };
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return { ok: true, message: "Note added." };
}

const flagSchema = z.object({ orderId: uuid, reason: z.string().trim().min(3, "Say why").max(300) });

export async function flagOrder(_prev: OrderActionState, fd: FormData): Promise<OrderActionState> {
  const parsed = flagSchema.safeParse({ orderId: fd.get("orderId"), reason: fd.get("reason") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Say why." };
  const auth = await checkStaff("risk.review");
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_flag_order", { p_order_id: parsed.data.orderId, p_reason: parsed.data.reason });
  if (error) return { ok: false, message: dbMessage(error), values: { reason: parsed.data.reason } };
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  revalidatePath("/admin/risk");
  return { ok: true, message: "Order sent to risk review." };
}
