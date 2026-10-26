import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { getAddresses, getCustomer } from "@/lib/account/session";
import { getCart } from "@/lib/cart/service";
import { BD_DIVISIONS } from "@/lib/geo/bd";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const [cart, customer] = await Promise.all([getCart(), getCustomer()]);
  if (cart.items.length === 0) redirect("/cart");
  const addresses = customer ? await getAddresses() : [];
  const addr = addresses.find((a) => a.is_default) ?? addresses[0];
  const prefill = customer
    ? {
        name: addr?.recipient_name ?? customer.fullName,
        phone: addr?.phone ?? customer.phone ?? "",
        email: customer.email ?? "",
        district: addr?.district ?? "",
        area: addr?.area ?? "",
        addressLine: addr?.address_line ?? "",
        postalCode: addr?.postal_code ?? "",
      }
    : undefined;
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl font-semibold text-espresso">Checkout</h1>
      {customer ? (
        <p className="mt-2 text-sm text-muted">Signed in as {customer.email}. This order will show in <Link href="/account" className="underline">your account</Link>.</p>
      ) : (
        <p className="mt-2 text-sm text-muted">
          No account needed. We&apos;ll call or text this number about delivery.{" "}
          <Link href="/account/login?next=/checkout" className="underline">Sign in</Link> to use a saved address.
        </p>
      )}
      <CheckoutForm cart={cart} divisions={BD_DIVISIONS} prefill={prefill} />
    </div>
  );
}
