import { createHmac, timingSafeEqual } from "node:crypto";
import type { CourierAdapter, CourierEvent, CourierId, ShipmentStatus } from "./types";

/**
 * Courier adapters.
 *
 * - `manual`: staff type the tracking number and move the shipment status by
 *   hand in the admin. No webhook, nothing to configure.
 * - `pathao`, `steadfast`, `redx`: SIGNED-WEBHOOK STUBS. Each accepts a JSON
 *   webhook signed with HMAC-SHA256 over the raw body using the courier's
 *   webhook secret, and maps that courier's documented status names to ours.
 *   They are NOT yet verified against live accounts: the real header name,
 *   signature scheme and payload shape must be confirmed when the merchant
 *   account exists, and the adapter adjusted. Until the secret is configured
 *   the endpoint answers 404, so nothing is claimed to be live.
 */

const SIGNATURE_HEADERS = ["x-webhook-signature", "x-signature", "x-hub-signature-256"];

function hmacVerify(secret: string | undefined, headers: Headers, rawBody: string): boolean {
  if (!secret) return false;
  const given = SIGNATURE_HEADERS.map((h) => headers.get(h)).find(Boolean)?.replace(/^sha256=/i, "").trim().toLowerCase();
  if (!given || !/^[a-f0-9]{64}$/.test(given)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
}

type Raw = Record<string, unknown>;
const str = (o: Raw, ...keys: string[]) => {
  for (const k of keys) if (o[k] != null && String(o[k]).trim()) return String(o[k]).trim().slice(0, 120);
  return "";
};

/** Generic JSON webhook: one event object or `{ events: [...] }`. */
function parseGeneric(body: unknown, mapStatus: (s: string) => ShipmentStatus | null): CourierEvent[] {
  const list: unknown[] = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as Raw).events) ? ((body as Raw).events as unknown[]) : [body];
  const out: CourierEvent[] = [];
  for (const item of list.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Raw;
    const trackingNumber = str(o, "tracking_number", "tracking_code", "trackingNumber", "consignment_id", "tracking_id");
    const status = str(o, "status", "delivery_status", "order_status", "event");
    const eventId = str(o, "event_id", "id", "update_id", "webhook_id") || (trackingNumber && status ? `${trackingNumber}:${status}:${str(o, "updated_at", "timestamp", "time")}` : "");
    if (!trackingNumber || !status || !eventId) continue;
    out.push({ eventId, trackingNumber, status, mapped: mapStatus(status) });
  }
  return out;
}

function table(map: Record<string, ShipmentStatus>) {
  const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "_");
  const lower: Record<string, ShipmentStatus> = {};
  for (const [k, v] of Object.entries(map)) lower[norm(k)] = v;
  return (s: string) => lower[norm(s)] ?? null;
}

const manual: CourierAdapter = {
  id: "manual",
  label: "Manual (staff updates)",
  isConfigured: () => true,
  verifyWebhook: () => false,
  parseWebhook: () => [],
  mapStatus: () => null,
};

const pathaoMap = table({
  pending: "ready_for_pickup",
  pickup_requested: "ready_for_pickup",
  assigned_for_pickup: "ready_for_pickup",
  picked: "handed_to_courier",
  picked_up: "handed_to_courier",
  pickup_failed: "ready_for_pickup",
  at_the_sorting_hub: "in_transit",
  in_transit: "in_transit",
  received_at_last_mile_hub: "in_transit",
  assigned_for_delivery: "out_for_delivery",
  delivered: "delivered",
  partial_delivery: "delivered",
  return: "rto",
  delivery_failed: "delivery_failed",
  on_hold: "delivery_failed",
  paid_return: "returned",
  returned: "returned",
});
const pathao: CourierAdapter = {
  id: "pathao",
  label: "Pathao Courier (stub, not verified against live API)",
  isConfigured: () => !!process.env.PATHAO_WEBHOOK_SECRET,
  verifyWebhook: (h, b) => hmacVerify(process.env.PATHAO_WEBHOOK_SECRET, h, b),
  parseWebhook: (body) => parseGeneric(body, pathaoMap),
  mapStatus: pathaoMap,
};

const steadfastMap = table({
  pending: "ready_for_pickup",
  in_review: "ready_for_pickup",
  hold: "delivery_failed",
  delivered_approval_pending: "delivered",
  partial_delivered_approval_pending: "delivered",
  cancelled_approval_pending: "rto",
  unknown_approval_pending: "delivery_failed",
  delivered: "delivered",
  partial_delivered: "delivered",
  cancelled: "rto",
  unknown: "delivery_failed",
  in_transit: "in_transit",
  picked_up: "handed_to_courier",
  out_for_delivery: "out_for_delivery",
  returned: "returned",
});
const steadfast: CourierAdapter = {
  id: "steadfast",
  label: "Steadfast (stub, not verified against live API)",
  isConfigured: () => !!process.env.STEADFAST_WEBHOOK_SECRET,
  verifyWebhook: (h, b) => hmacVerify(process.env.STEADFAST_WEBHOOK_SECRET, h, b),
  parseWebhook: (body) => parseGeneric(body, steadfastMap),
  mapStatus: steadfastMap,
};

const redxMap = table({
  pickup_pending: "ready_for_pickup",
  pickup_requested: "ready_for_pickup",
  picked_up: "handed_to_courier",
  received_at_hub: "in_transit",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  delivery_failed: "delivery_failed",
  return_in_progress: "rto",
  returned: "returned",
});
const redx: CourierAdapter = {
  id: "redx",
  label: "RedX (stub, not verified against live API)",
  isConfigured: () => !!process.env.REDX_WEBHOOK_SECRET,
  verifyWebhook: (h, b) => hmacVerify(process.env.REDX_WEBHOOK_SECRET, h, b),
  parseWebhook: (body) => parseGeneric(body, redxMap),
  mapStatus: redxMap,
};

const ADAPTERS: Record<CourierId, CourierAdapter> = { manual, pathao, steadfast, redx };

export function getCourierAdapter(id: string): CourierAdapter | null {
  return (ADAPTERS as Record<string, CourierAdapter>)[id] ?? null;
}

export function listCouriers(): CourierAdapter[] {
  return Object.values(ADAPTERS);
}

export { hmacVerify as verifyHmacWebhook, parseGeneric as parseGenericWebhook };
