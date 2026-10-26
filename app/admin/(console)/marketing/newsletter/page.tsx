import Link from "next/link";
import { SuppressionForm } from "@/components/admin/marketing-forms";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { removeSuppression } from "../actions";

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

export default async function NewsletterPage({ searchParams }: PageProps<"/admin/marketing/newsletter">) {
  const staff = await requireStaff("marketing.read");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && ["subscribed", "pending", "unsubscribed"].includes(sp.status) ? sp.status : "subscribed";
  const supabase = await createSupabaseServerClient();
  const [{ data: subs, count }, { data: supp }] = await Promise.all([
    supabase.from("newsletter_subscriptions").select("id, email, status, source, confirmed_at, unsubscribed_at, created_at", { count: "exact" }).eq("status", status).order("created_at", { ascending: false }).limit(200),
    supabase.from("unsubscribes").select("id, identifier, channel, reason, created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  const canManage = staff.permissions.includes("marketing.manage");
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold text-espresso">Newsletter</h1>
        {canManage ? <Link href="/admin/marketing/newsletter/export" prefetch={false} className="rounded border border-espresso px-3 py-1.5 text-sm">Export subscribed (CSV)</Link> : null}
      </div>
      <nav className="flex gap-2 text-sm" aria-label="Status">
        {["subscribed", "pending", "unsubscribed"].map((s) => (
          <Link key={s} href={`/admin/marketing/newsletter?status=${s}`} className={`rounded-full px-3 py-1 ${s === status ? "bg-espresso text-cream" : "bg-sand"}`}>{s}</Link>
        ))}
        <span className="self-center text-muted">{count ?? 0} total</span>
      </nav>
      <table className="w-full text-sm" data-testid="newsletter-table">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-2">Email</th><th>Source</th><th>Signed up</th><th>Confirmed</th><th>Unsubscribed</th></tr></thead>
        <tbody>
          {(subs ?? []).length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-muted">Nobody here yet.</td></tr> : null}
          {(subs ?? []).map((r) => (
            <tr key={r.id} className="border-t border-line"><td className="py-1">{r.email}</td><td>{r.source}</td><td>{dateFmt.format(new Date(r.created_at))}</td><td>{r.confirmed_at ? dateFmt.format(new Date(r.confirmed_at)) : "—"}</td><td>{r.unsubscribed_at ? dateFmt.format(new Date(r.unsubscribed_at)) : "—"}</td></tr>
          ))}
        </tbody>
      </table>
      <section className="space-y-3">
        <h2 className="font-semibold text-espresso">Suppression list</h2>
        <p className="text-xs text-muted">Nobody on this list receives marketing on the listed channel, whatever their opt-in state. Transactional order messages are not affected.</p>
        {canManage ? <SuppressionForm /> : null}
        <table className="w-full text-sm" data-testid="suppression-table">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-2">Identifier</th><th>Channel</th><th>Reason</th><th>Since</th><th></th></tr></thead>
          <tbody>
            {(supp ?? []).map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1">{r.identifier}</td><td>{r.channel}</td><td>{r.reason ?? ""}</td><td>{dateFmt.format(new Date(r.created_at))}</td>
                <td>{canManage ? <form action={removeSuppression.bind(null, r.id)}><button type="submit" className="text-xs underline">Remove</button></form> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
