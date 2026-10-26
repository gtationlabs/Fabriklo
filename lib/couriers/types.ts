/**
 * Courier integration contract. Status updates from a courier reach the order
 * only through `public.courier_apply_event`, which de-duplicates on
 * (courier, event id) and enforces the shipment state machine.
 */
export type CourierId = "manual" | "pathao" | "steadfast" | "redx";

/** Our shipment states (see private.order_transition_allowed). */
export type ShipmentStatus =
  | "ready_for_pickup"
  | "handed_to_courier"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_failed"
  | "rto"
  | "returned";

export type CourierEvent = {
  /** Courier's unique id for this message; used for de-duplication. */
  eventId: string;
  trackingNumber: string;
  /** The courier's own status string, stored verbatim. */
  status: string;
  /** Our status, or null when the courier's status has no equivalent (stored, not applied). */
  mapped: ShipmentStatus | null;
};

export interface CourierAdapter {
  readonly id: CourierId;
  readonly label: string;
  /** True when credentials/secrets for this courier are configured. */
  isConfigured(): boolean;
  /** Verifies the webhook came from the courier (signature or shared secret). */
  verifyWebhook(headers: Headers, rawBody: string): boolean;
  /** Turns a verified webhook body into zero or more events. */
  parseWebhook(body: unknown): CourierEvent[];
  /** Maps a courier status to ours. */
  mapStatus(status: string): ShipmentStatus | null;
}
