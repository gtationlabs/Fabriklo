/** Human labels for order states (customer and staff facing). */
export const STATUS_LABELS: Record<string, string> = {
  placed: "Order placed",
  unpaid: "Unpaid",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  failed: "Payment failed",
  cod_pending: "Cash due on delivery",
  cod_collected: "Cash collected",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
  voided: "Voided",
  unfulfilled: "Received",
  confirmed: "Confirmed",
  picking: "Being picked",
  packed: "Packed",
  partially_fulfilled: "Partly sent",
  fulfilled: "Sent",
  cancelled: "Cancelled",
  not_shipped: "Not shipped yet",
  ready_for_pickup: "Ready for courier pickup",
  handed_to_courier: "With the courier",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  delivery_failed: "Delivery attempt failed",
  rto: "Returning to us",
  returned: "Returned to us",
  not_required: "No review needed",
  needs_review: "Needs review",
  verified: "Verified",
  approved: "Approved",
  rejected_with_reason: "Rejected",
  blocked_by_policy: "Blocked by policy",
};

export const label = (s: string | null | undefined) => (s ? (STATUS_LABELS[s] ?? s.replace(/_/g, " ")) : "");

/** A single customer-facing headline for an order. */
export function customerHeadline(o: { fulfillment_status: string; shipment_status: string }): string {
  if (o.fulfillment_status === "cancelled") return "Cancelled";
  if (o.shipment_status !== "not_shipped") return label(o.shipment_status);
  return label(o.fulfillment_status === "unfulfilled" ? "placed" : o.fulfillment_status);
}

/** Staff transition menu: next states per field (mirrors private.order_transition_allowed). */
export const NEXT_STATES: Record<string, Record<string, string[]>> = {
  fulfillment_status: {
    unfulfilled: ["confirmed", "cancelled"],
    confirmed: ["picking", "cancelled"],
    picking: ["packed", "cancelled"],
    packed: ["cancelled"],
  },
  shipment_status: {
    not_shipped: ["ready_for_pickup"],
    ready_for_pickup: ["handed_to_courier"],
    handed_to_courier: ["in_transit"],
    in_transit: ["out_for_delivery"],
    out_for_delivery: ["delivered", "delivery_failed"],
    delivery_failed: ["out_for_delivery", "rto"],
    rto: ["returned"],
  },
  payment_status: { cod_pending: ["cod_collected"] },
  risk_review_status: {
    not_required: ["needs_review"],
    needs_review: ["verified", "approved", "rejected_with_reason", "blocked_by_policy"],
    verified: ["approved", "rejected_with_reason"],
  },
};

/** Transitions that require a written reason (enforced again in the database). */
export const NEEDS_REASON = new Set(["cancelled", "rejected_with_reason", "blocked_by_policy", "delivery_failed", "needs_review"]);
