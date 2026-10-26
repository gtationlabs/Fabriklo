import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { getCart } from "@/lib/cart/service";
import { BD_DIVISIONS } from "@/lib/geo/bd";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const cart = await getCart();
  if (cart.items.length === 0) redirect("/cart");
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">Checkout</h1>
      <p className="mt-2 text-sm text-muted">No account needed. We&apos;ll call or text this number about delivery.</p>
      <CheckoutForm cart={cart} divisions={BD_DIVISIONS} />
    </div>
  );
}
