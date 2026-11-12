import type { Metadata } from "next";
import { AccountShell } from "@/components/account/account-shell";
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
    <AccountShell title="Your addresses" current="/account/addresses" crumbs={[{ label: "Address book" }]} intro="Up to 10 delivery addresses. The default one fills in at checkout.">
      <div className="max-w-3xl">
      <ul className="space-y-4" data-testid="address-list">
        {addresses.map((a) => (
          <li key={a.id} className="space-y-2">
            <details className="group rounded-[6px] border border-neutral-200 bg-white">
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
      <h2 className="mt-10 text-[13px] font-semibold uppercase tracking-[0.14em]">Add an address</h2>
      <div className="mt-4 rounded-[6px] border border-neutral-200 bg-mist p-5"><AddressForm divisions={BD_DIVISIONS} /></div>
      </div>
    </AccountShell>
  );
}
