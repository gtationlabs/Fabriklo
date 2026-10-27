import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function count(q: PromiseLike<{ count: number | null; error: unknown }>) {
  const { count, error } = await q;
  return error ? null : (count ?? 0);
}

export default async function AdminOverview({ searchParams }: PageProps<"/admin">) {
  const staff = await requireStaff();
  const { denied } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const can = (p: string) => staff.permissions.includes(p as never);

  const [active, drafts, alerts, orders] = await Promise.all([
    can("products.read") ? count(supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "active")) : null,
    can("products.read") ? count(supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft")) : null,
    can("inventory.read")
      ? supabase.rpc("admin_stock_alerts").then(({ data, error }) => (error ? null : (data as { low: number; out: number })))
      : null,
    can("orders.read") ? count(supabase.from("orders").select("id", { count: "exact", head: true })) : null,
  ]);

  const kpis = [
    { label: "Active products", value: active, href: "/admin/products?status=active" },
    { label: "Draft products", value: drafts, href: "/admin/products?status=draft" },
    { label: "Low-stock SKUs", value: alerts ? alerts.low : null, href: "/admin/inventory" },
    { label: "Sold-out SKUs", value: alerts ? alerts.out : null, href: "/admin/inventory" },
    { label: "Orders (all time)", value: orders, href: null },
  ].filter((k) => k.value !== null);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold text-espresso">Overview</h1>
        <p className="text-sm text-muted">Live figures from the database. Catalogue figures include demo products in development.</p>
      </header>
      {denied ? (
        <p role="alert" className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          You don&apos;t have the “{String(denied)}” permission for that page.
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-line bg-white p-5">
            <dt className="text-xs uppercase tracking-wider text-muted">{k.label}</dt>
            <dd className="mt-2 text-3xl font-semibold text-espresso">
              {k.href ? <Link href={k.href}>{k.value}</Link> : k.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">
        Sales, revenue and COD KPIs appear here once the order milestone ships; nothing is estimated or invented.
      </p>
    </div>
  );
}
