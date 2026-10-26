import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm"><Link href="/account" className="underline">My account</Link></p>
      <h1 className="mt-2 font-display text-4xl font-semibold text-espresso">My try-ons</h1>
      <p className="mt-2 text-sm text-muted">Photos and results are private to you and are deleted automatically when they expire. You can delete any of them now.</p>
      {jobs.length === 0 ? (
        <p className="mt-6 rounded border border-dashed border-line p-6 text-sm text-muted">No try-ons yet. Look for “Try it on with your photo” on supported products.</p>
      ) : (
        <ul className="mt-6 space-y-4" data-testid="tryon-history">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-start gap-4 rounded border border-line bg-white p-4 text-sm">
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
  );
}
