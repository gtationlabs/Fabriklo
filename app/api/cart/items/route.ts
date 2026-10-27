import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CartError, getCart, setCartItem } from "@/lib/cart/service";
import { forbiddenOrigin, jsonError, rateLimited, zodError } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

const bodySchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(0).max(10),
  mode: z.enum(["set", "increment"]).default("set"),
});

const deleteSchema = z.object({ variantId: z.uuid() });

async function guard(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const rl = await enforceRateLimit(`cart:${clientIp(req.headers)}`, 60, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  return null;
}

async function readJson(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > 2_000) return null;
  return req.json().catch(() => null);
}

function cartErrorResponse(e: unknown) {
  if (e instanceof CartError) {
    const status = e.code === "out_of_stock" ? 409 : e.code === "unknown" ? 500 : 422;
    return jsonError(status, e.code, e.message);
  }
  return jsonError(500, "unknown", "Something went wrong.");
}

async function upsert(req: NextRequest) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return zodError(parsed.error);
  const { variantId, quantity, mode } = parsed.data;
  try {
    let target = quantity;
    if (mode === "increment") {
      const current = (await getCart()).items.find((i) => i.variant_id === variantId)?.quantity ?? 0;
      target = Math.min(10, current + quantity);
    }
    const cart = await setCartItem(variantId, target);
    return NextResponse.json(cart, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return cartErrorResponse(e);
  }
}

export const POST = upsert;
export const PATCH = upsert;

export async function DELETE(req: NextRequest) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const parsed = deleteSchema.safeParse(await readJson(req));
  if (!parsed.success) return zodError(parsed.error);
  try {
    const cart = await setCartItem(parsed.data.variantId, 0);
    return NextResponse.json(cart, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return cartErrorResponse(e);
  }
}
