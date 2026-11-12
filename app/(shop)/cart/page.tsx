import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, ShoppingBag, Truck } from "lucide-react";
import { CartLines } from "@/components/shop/cart-lines";
import { EmptyState, Panel, StorePage, btnOutline, btnPrimary } from "@/components/shop/store-page";
import { getCart } from "@/lib/cart/service";
import { formatBDT } from "@/lib/money";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage() {
  const cart = await getCart();
  return (
    <StorePage
      title="Your cart"
      crumbs={[{ label: "Shopping bag" }]}
      intro={cart.items.length ? `${cart.item_count} ${cart.item_count === 1 ? "item" : "items"} in your bag` : undefined}
    >
      {cart.items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag aria-hidden className="h-5 w-5" strokeWidth={1.6} />}
          title="Your cart is empty."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/shop" className={btnPrimary}>
                Start shopping
              </Link>
              <Link href="/wishlist" className={btnOutline}>
                View wishlist
              </Link>
            </div>
          }
        >
          Pieces you add to your bag stay here while you browse.
        </EmptyState>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <div>
            <CartLines cart={cart} />
            <Link href="/shop" className="mt-6 inline-block text-[13px] underline underline-offset-4 hover:no-underline">
              Continue shopping
            </Link>
          </div>
          <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <Panel title="Order summary" tone="mist">
              <dl className="space-y-3 text-[14px]">
                <div className="flex justify-between">
                  <dt>Subtotal ({cart.item_count} items)</dt>
                  <dd data-testid="cart-subtotal" className="font-medium">
                    {formatBDT(cart.subtotal_minor)}
                  </dd>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <dt>Delivery</dt>
                  <dd>Calculated at checkout</dd>
                </div>
              </dl>
              <Link href="/checkout" className={`${btnPrimary} mt-6 w-full`}>
                Checkout
              </Link>
              <p className="mt-3 text-[12px] text-neutral-600">Prices and stock are checked again on our server when you place the order.</p>
            </Panel>
            <ul className="space-y-3 px-1 text-[13px] text-neutral-700">
              <li className="flex items-center gap-3">
                <Truck aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
                Cash on delivery across Bangladesh
              </li>
              <li className="flex items-center gap-3">
                <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
                We confirm every order by phone before dispatch
              </li>
            </ul>
          </div>
        </div>
      )}
    </StorePage>
  );
}
