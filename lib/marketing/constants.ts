export const TRIGGERS = [
  "order.placed", "payment.verified", "cod.awaiting_verification", "order.packed", "order.delivered", "delivery.failed", "return.requested",
  "cart.abandoned", "stock.low", "stock.back_in_stock", "customer.signup", "tryon.completed", "tryon.failed", "summary.weekly",
] as const;
export type TriggerType = (typeof TRIGGERS)[number];

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  "order.placed": "New order placed",
  "payment.verified": "Online payment verified",
  "cod.awaiting_verification": "COD order awaiting verification",
  "order.packed": "Order packed",
  "order.delivered": "Order delivered",
  "delivery.failed": "Delivery failed",
  "return.requested": "Return / RTO",
  "cart.abandoned": "Cart abandoned (signed-in customers)",
  "stock.low": "Low stock",
  "stock.back_in_stock": "Back in stock",
  "customer.signup": "Customer signed up",
  "tryon.completed": "Try-on completed",
  "tryon.failed": "Try-on failed",
  "summary.weekly": "Weekly summary (Mondays)",
};

export const CONDITION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "exists", "not_exists"] as const;
export const ACTION_TYPES = ["email", "sms", "whatsapp", "internal_alert", "review_task", "notify_inventory", "webhook"] as const;

/** Fields a condition may reference: the event's columns plus payload keys per trigger. */
export const CONDITION_FIELDS = [
  "event_type", "email", "phone", "has_email", "has_phone", "is_customer", "order_number", "total_minor", "discount_minor", "payment_method", "payment_status",
  "fulfillment_status", "shipment_status", "district", "risk_level", "is_demo", "coupon_code", "item_count", "sku", "product_title", "available", "reorder_point",
  "subtotal_minor", "provider", "error_code", "orders", "revenue_minor",
] as const;

export const OUTBOX_STATUSES = ["queued", "sending", "sent", "failed", "dead", "suppressed"] as const;
