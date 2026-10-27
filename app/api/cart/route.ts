import { NextResponse } from "next/server";
import { getCart } from "@/lib/cart/service";

export async function GET() {
  const cart = await getCart();
  return NextResponse.json(cart, { headers: { "Cache-Control": "private, no-store" } });
}
