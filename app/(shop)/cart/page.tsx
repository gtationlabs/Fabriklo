import type { Metadata } from "next";
import Link from "next/link";
import { CartLines } from "@/components/shop/cart-lines";
import { getCart } from "@/lib/cart/service";
import { formatBDT } from "@/lib/money";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage() {
  const cart = await getCart();
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">Your cart</h1>
      {cart.items.length === 0 ? (
        <div className="mt-8 rounded border border-dashed border-line p-10 text-center">
          <p className="text-espresso">Your cart is empty.</p>
          <Link href="/shop" className="mt-4 inline-block rounded bg-espresso px-5 py-2.5 text-cream">
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
          <CartLines cart={cart} />
          <aside className="h-fit rounded border border-line bg-cream p-6">
            <h2 className="font-semibold text-espresso">Summary</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal ({cart.item_count} items)</dt>
                <dd data-testid="cart-subtotal">{formatBDT(cart.subtotal_minor)}</dd>
              </div>
              <div className="flex justify-between text-muted">
                <dt>Delivery</dt>
                <dd>Calculated at checkout</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted">
              Prices and stock are checked again on our server when you place the order.
            </p>
            <button
              type="button"
              disabled
              aria-describedby="checkout-soon"
              className="mt-6 w-full cursor-not-allowed rounded bg-espresso/60 px-5 py-3 font-medium text-cream"
            >
              Checkout
            </button>
            <p id="checkout-soon" className="mt-2 text-xs text-muted">
              Checkout with cash on delivery arrives in the next milestone.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
