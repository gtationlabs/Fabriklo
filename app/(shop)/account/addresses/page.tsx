import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AddressForm } from "@/components/account/forms";
import { deleteAddress } from "../actions";
import { getAddresses, getCustomer } from "@/lib/account/session";
import { BD_DIVISIONS } from "@/lib/geo/bd";

export const metadata: Metadata = { title: "Your addresses", robots: { index: false } };

export default async function AddressesPage() {
  if (!(await getCustomer())) redirect("/account/login?next=/account/addresses");
  const addresses = await getAddresses();
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm"><Link href="/account" className="underline">My account</Link></p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-espresso">Your addresses</h1>
      <ul className="mt-8 space-y-6" data-testid="address-list">
        {addresses.map((a) => (
          <li key={a.id} className="space-y-2">
            <details className="group rounded border border-line bg-white">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{a.label}</span>{a.is_default ? <span className="ml-2 rounded-full bg-sand px-2 py-0.5 text-xs">Default</span> : null}
                  <span className="block text-muted">{a.recipient_name} · {a.address_line}, {a.area}, {a.district}</span>
                </span>
                <span className="underline">Edit</span>
              </summary>
              <div className="border-t border-line p-4">
                <AddressForm address={a} divisions={BD_DIVISIONS} />
                <form action={deleteAddress} className="mt-2 text-right">
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="text-xs text-danger underline">Delete this address</button>
                </form>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <h2 className="mt-10 font-semibold text-espresso">Add an address</h2>
      <div className="mt-3"><AddressForm divisions={BD_DIVISIONS} /></div>
    </div>
  );
}
