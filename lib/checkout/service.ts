import "server-only";
import { cookies } from "next/headers";
import { CART_COOKIE } from "@/lib/cart/service";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Quote } from "./schema";
import type { placeOrderSchema } from "./schema";
import type { z } from "zod";

export const LAST_ORDER_COOKIE = "fbk_last_order";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type CheckoutErrorCode =
  | "cart_missing"
  | "cart_empty"
  | "stock_unavailable"
  | "no_delivery"
  | "quote_changed"
  | "cod_unavailable"
  | "payment_unavailable"
  | "invalid_input"
  | "unknown";

export class CheckoutError extends Error {
  constructor(
    public code: CheckoutErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<CheckoutErrorCode, string> = {
  cart_missing: "Your cart has expired or was already checked out.",
  cart_empty: "Your cart is empty.",
  stock_unavailable: "Some items just sold out or changed. Please review your cart.",
  no_delivery: "We can't deliver to that district yet.",
  quote_changed: "The total changed since you opened checkout. Please check the new total and confirm again.",
  cod_unavailable: "Cash on delivery isn't available for this order.",
  payment_unavailable: "That payment method isn't available.",
  invalid_input: "Some details are invalid.",
  unknown: "We couldn't place your order. Please try again.",
};

async function cartToken() {
  const token = (await cookies()).get(CART_COOKIE)?.value ?? null;
  return token && TOKEN_RE.test(token) ? token : null;
}

export async function getQuote(district: string | null): Promise<Quote | null> {
  const token = await cartToken();
  if (!token) return null;
  const { data, error } = await createSupabasePublicClient().rpc("checkout_quote", {
    p_cart_token: token,
    p_district: district,
  });
  if (error || !data) return null;
  return data as Quote;
}

export type PlacedOrder = { orderNumber: string; trackingToken: string; totalMinor: number; replayed: boolean };

export async function placeOrder(input: z.output<typeof placeOrderSchema>): Promise<PlacedOrder> {
  const token = await cartToken();
  if (!token) throw new CheckoutError("cart_missing", MESSAGES.cart_missing);
  // The user's own client: when signed in, Postgres links the order to auth.uid().
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_order", {
    p_cart_token: token,
    p_idempotency_key: input.idempotencyKey,
    p_customer: { name: input.name, phone: input.phone, email: input.email ?? null },
    p_address: {
      district: input.district,
      area: input.area,
      address_line: input.addressLine,
      postal_code: input.postalCode || null,
    },
    p_payment_method: input.paymentMethod,
    p_expected_total_minor: input.expectedTotalMinor,
    p_note: input.note || null,
  });
  if (error) {
    const hint = (error.hint ?? "") as CheckoutErrorCode;
    if (hint in MESSAGES) throw new CheckoutError(hint, MESSAGES[hint]);
    if (error.code === "22023") throw new CheckoutError("invalid_input", MESSAGES.invalid_input);
    throw new CheckoutError("unknown", MESSAGES.unknown);
  }
  const r = data as { order_number: string; tracking_token: string; total_minor: number; replayed: boolean };
  const jar = await cookies();
  // The cart is converted; drop its token. Keep the receipt briefly for the success page.
  jar.delete(CART_COOKIE);
  jar.set(LAST_ORDER_COOKIE, `${r.order_number}.${r.tracking_token}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/order",
    maxAge: 60 * 60,
  });
  return { orderNumber: r.order_number, trackingToken: r.tracking_token, totalMinor: r.total_minor, replayed: r.replayed };
}

export type TrackedOrder = {
  order_number: string;
  placed_at: string;
  payment_method: "cod" | "sslcommerz";
  payment_status: string;
  fulfillment_status: string;
  shipment_status: string;
  subtotal_minor: number;
  shipping_minor: number;
  discount_minor: number;
  total_minor: number;
  is_demo: boolean;
  recipient: string;
  phone_masked: string;
  district: string;
  estimate: { name: string; min_days: number; max_days: number } | null;
  items: { title: string; size: string; color: string; quantity: number; line_total_minor: number }[];
  events: { at: string; field: string; status: string }[];
  shipment: { courier: string; tracking_number: string | null; tracking_url: string | null } | null;
};

export async function trackOrder(orderNumber: string, token: string): Promise<TrackedOrder | null> {
  if (!/^FBK-\d{6,10}$/.test(orderNumber) || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const { data, error } = await createSupabasePublicClient().rpc("track_order", {
    p_order_number: orderNumber,
    p_token: token,
  });
  if (error || !data) return null;
  return data as TrackedOrder;
}
