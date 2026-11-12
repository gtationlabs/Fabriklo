import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell } from "@/components/account/account-shell";
import { getCustomer } from "@/lib/account/session";
import { listMyJobs } from "@/lib/tryon/service";
import { tryonMessageFor } from "@/lib/tryon/types";
import { deleteTryonJob } from "./actions";

export const metadata: Metadata = { title: "My try-ons", robots: { index: false } };
const dateFmt = new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

export default async function TryonHistoryPage() {
  const customer = await getCustomer();
  if (!customer) redirect("/account/login?next=/account/try-on");
  const jobs = (await listMyJobs()) as (Awaited<ReturnType<typeof listMyJobs>>[number] & { product?: { title: string; slug: string } })[];
  return (
    <AccountShell title="My try-ons" current="/account/try-on" crumbs={[{ label: "Try-on photos" }]} intro="Photos and results are private to you and are deleted automatically when they expire. You can delete any of them now.">
      <div className="max-w-3xl">
      {jobs.length === 0 ? (
        <p className="rounded-[6px] border border-dashed border-neutral-300 bg-mist p-6 text-sm text-muted">No try-ons yet. Look for “Try it on with your photo” on supported products, or read <Link href="/try-on" className="underline">how AI try-on works</Link>.</p>
      ) : (
        <ul className="space-y-4" data-testid="tryon-history">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-start gap-4 rounded-[6px] border border-neutral-200 bg-white p-4 text-sm">
              {j.output_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={j.output_url} alt="" className="h-28 w-20 rounded object-cover" />
              ) : (
                <div className="grid h-28 w-20 place-items-center rounded bg-sand text-xs text-muted">{j.status}</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{j.product ? <Link href={`/product/${j.product.slug}`} className="hover:underline">{j.product.title}</Link> : "Product"}</p>
                <p className="text-muted">{dateFmt.format(new Date(j.created_at))} · {j.status}{j.provider === "mock" ? " · demo mock" : ""}</p>
                {j.status === "failed" ? <p className="text-danger">{tryonMessageFor(j.error_code)}</p> : null}
                <p className="text-xs text-muted">Expires {dateFmt.format(new Date(j.expires_at))}</p>
              </div>
              <form action={deleteTryonJob.bind(null, j.id)}>
                <button type="submit" className="rounded border border-danger px-3 py-1.5 text-danger">Delete</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      </div>
    </AccountShell>
  );
}
