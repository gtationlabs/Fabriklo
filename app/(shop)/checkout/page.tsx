import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StorePage } from "@/components/shop/store-page";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { Turnstile } from "@/components/security/turnstile";
import { getAddresses, getCustomer } from "@/lib/account/session";
import { getCart } from "@/lib/cart/service";
import { BD_DIVISIONS } from "@/lib/geo/bd";
import { onlinePaymentOffer } from "@/lib/payments";

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
    <StorePage
      title="Checkout"
      crumbs={[{ href: "/cart", label: "Shopping bag" }, { label: "Checkout" }]}
      intro={
        customer ? (
          <>Signed in as {customer.email}. This order will show in <Link href="/account" className="underline">your account</Link>.</>
        ) : (
          <>
            No account needed. We&apos;ll call or text this number about delivery.{" "}
            <Link href="/account/login?next=/checkout" className="underline">Sign in</Link> to use a saved address.
          </>
        )
      }
    >
      <ol className="mx-auto -mt-4 mb-2 flex max-w-md items-center justify-center gap-3 text-[12px] uppercase tracking-[0.14em]" aria-label="Checkout steps">
        <li className="text-neutral-500"><Link href="/cart" className="hover:underline">Bag</Link></li>
        <li aria-hidden className="h-px w-8 bg-neutral-300" />
        <li aria-current="step" className="font-semibold">Details &amp; payment</li>
        <li aria-hidden className="h-px w-8 bg-neutral-300" />
        <li className="text-neutral-500">Confirmation</li>
      </ol>
      <CheckoutForm cart={cart} divisions={BD_DIVISIONS} prefill={prefill} online={onlinePaymentOffer()} challenge={<Turnstile action="checkout" />} />
    </StorePage>
  );
}
