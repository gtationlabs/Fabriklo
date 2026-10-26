import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { EMPTY_CART, type Cart } from "./types";

/**
 * Guest carts are capability tokens: a random 256-bit token lives only in an
 * httpOnly cookie; the database stores its SHA-256 hash. All pricing and stock
 * checks happen inside Postgres (cart_get / cart_set_item).
 */
export const CART_COOKIE = "fbk_cart";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const setItemSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(0).max(10),
});

export class CartError extends Error {
  constructor(
    public code: "not_available" | "out_of_stock" | "invalid" | "cart_missing" | "unknown",
    message: string,
  ) {
    super(message);
  }
}

async function readToken(): Promise<string | null> {
  const token = (await cookies()).get(CART_COOKIE)?.value ?? null;
  return token && TOKEN_RE.test(token) ? token : null;
}

async function writeToken(token: string) {
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getCart(): Promise<Cart> {
  const token = await readToken();
  if (!token) return EMPTY_CART;
  const { data, error } = await createSupabasePublicClient().rpc("cart_get", { p_token: token });
  if (error || !data) return EMPTY_CART;
  return data as Cart;
}

function mapError(error: { code?: string; message: string; hint?: string }): CartError {
  if (error.hint === "stock_unavailable") return new CartError("out_of_stock", error.message);
  if (error.code === "22023") return new CartError("not_available", "That item can't be added right now.");
  if (error.code === "P0002") return new CartError("cart_missing", "Your cart expired. Please try again.");
  return new CartError("unknown", "Something went wrong updating your cart.");
}

export async function setCartItem(variantId: string, quantity: number): Promise<Cart> {
  const supabase = createSupabasePublicClient();
  let token = await readToken();
  if (!token && quantity === 0) return EMPTY_CART;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) {
      const { data, error } = await supabase.rpc("cart_create");
      if (error || typeof data !== "string") throw new CartError("unknown", "Could not create a cart.");
      token = data;
      await writeToken(token);
    }
    const { data, error } = await supabase.rpc("cart_set_item", {
      p_token: token,
      p_variant_id: variantId,
      p_quantity: quantity,
    });
    if (!error) return data as Cart;
    const mapped = mapError(error);
    if (mapped.code === "cart_missing" && attempt === 0) {
      token = null; // stale cookie: start a fresh cart once
      continue;
    }
    throw mapped;
  }
  throw new CartError("unknown", "Could not update the cart.");
}
