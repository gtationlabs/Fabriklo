import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, EmptyState, PageHeader, SelectField, TextField } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteLead, updateLead } from "./actions";

export const metadata: Metadata = { title: "Checkout leads" };

type Lead = {
  id: string; name: string; phone: string; email: string | null; district: string | null; address_line: string | null;
  items: { title: string; size: string; color: string; quantity: number; unit_price_minor: number }[];
  item_count: number; subtotal_minor: number; status: "open" | "contacted" | "recovered" | "lost";
  order_id: string | null; staff_note: string | null; contacted_at: string | null; created_at: string; updated_at: string;
};

const STATUSES = ["open", "contacted", "recovered", "lost"] as const;
const TONE = { open: "warn", contacted: "info", recovered: "good", lost: "neutral" } as const;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function CheckoutLeadsPage({ searchParams }: PageProps<"/admin/checkout-leads">) {
  const staff = await requireStaff("orders.read");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : null;
  const supabase = await createSupabaseServerClient();
  let q = supabase.from("checkout_leads").select("*").order("updated_at", { ascending: false }).limit(200);
  if (status) q = q.eq("status", status);
  const [{ data }, { data: all }] = await Promise.all([q, supabase.from("checkout_leads").select("status, subtotal_minor")]);
  const leads = (data ?? []) as Lead[];
  const totals = { open: 0, contacted: 0, recovered: 0, lost: 0 } as Record<Lead["status"], number>;
  let openValue = 0;
  for (const l of (all ?? []) as { status: Lead["status"]; subtotal_minor: number }[]) {
    totals[l.status] += 1;
    if (l.status === "open" || l.status === "contacted") openValue += l.subtotal_minor;
  }
  const canUpdate = staff.permissions.includes("orders.fulfill");
  const canDelete = staff.permissions.includes("customers.manage");

  return (
    <div>
      <PageHeader
        title="Checkout Leads"
        description="Shoppers who typed a mobile number at checkout but have not placed the order yet. Call or message them, then mark the lead. A lead closes itself as recovered when that cart becomes an order. Leads are deleted after 90 days."
      />
      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {STATUSES.map((s) => (
          <Link key={s} href={status === s ? "/admin/checkout-leads" : `/admin/checkout-leads?status=${s}`} className={`rounded-xl border bg-white p-4 ${status === s ? "border-espresso" : "border-line"}`}>
            <dt className="text-xs uppercase tracking-wider text-muted">{s}</dt>
            <dd className="mt-1 text-2xl font-semibold text-espresso">{totals[s]}</dd>
          </Link>
        ))}
        <div className="rounded-xl border border-line bg-white p-4">
          <dt className="text-xs uppercase tracking-wider text-muted">Value still open</dt>
          <dd className="mt-1 text-2xl font-semibold text-espresso">{formatBDT(openValue)}</dd>
        </div>
      </dl>
      {leads.length === 0 ? <EmptyState>{status ? `No ${status} leads.` : "No checkout leads yet. They appear here when a shopper enters a mobile number at checkout."}</EmptyState> : null}
      <ul className="space-y-3" data-testid="leads-list">
        {leads.map((l) => {
          const wa = l.phone.replace(/^\+/, "");
          return (
            <li key={l.id} className="rounded-xl border border-line bg-white p-5">
              <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                <div className="min-w-48">
                  <p className="font-semibold text-espresso">{l.name || "No name yet"}</p>
                  <p className="text-sm"><a href={`tel:${l.phone}`} className="underline-offset-4 hover:underline">{l.phone}</a> · <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="text-success underline-offset-4 hover:underline">WhatsApp</a></p>
                  {l.email ? <p className="text-xs text-muted">{l.email}</p> : null}
                </div>
                <div className="min-w-48 flex-1 text-sm">
                  <p className="text-muted">{[l.address_line, l.district].filter(Boolean).join(", ") || "No address yet"}</p>
                  <p className="mt-1">{l.items.map((i) => `${i.title} (${i.size}/${i.color}) × ${i.quantity}`).join(" · ")}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-espresso">{formatBDT(l.subtotal_minor)}</p>
                  <p className="text-xs text-muted">{l.item_count} items · {fmt(l.updated_at)}</p>
                  <div className="mt-1"><Badge tone={TONE[l.status]}>{l.status}</Badge></div>
                  {l.order_id ? <Link href={`/admin/orders/${l.order_id}`} className="text-xs underline">View order</Link> : null}
                </div>
              </div>
              {canUpdate || canDelete ? (
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                  {canUpdate ? (
                    <ActionForm action={updateLead.bind(null, l.id)} label={`Lead ${l.phone}`} submitLabel="Update" className="flex flex-1 flex-wrap items-end gap-3">
                      <SelectField label="Status" name="status" defaultValue={l.status} options={STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))} />
                      <TextField label="Note" name="staff_note" defaultValue={l.staff_note} maxLength={500} className="min-w-60 flex-1" placeholder="e.g. Called, will order tonight" />
                    </ActionForm>
                  ) : null}
                  {canDelete ? <ActionForm action={deleteLead.bind(null, l.id)} label={`Delete lead ${l.phone}`} submitLabel="Delete" danger compact confirm="Delete this lead and its personal details?" /> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
