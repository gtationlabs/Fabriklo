import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUSES = ["all", "active", "draft", "archived"] as const;

export default async function AdminProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const staff = await requireStaff("products.read");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? (sp.status as string) : "all";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("products")
    .select("id, title, slug, status, is_demo, updated_at, category:categories(name), variants:product_variants(count)")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (status !== "all") query = query.eq("status", status);
  if (q) query = query.ilike("title", `%${q.replace(/[%_,()]/g, "")}%`);
  const { data, error } = await query;
  type Row = { id: string; title: string; slug: string; status: string; is_demo: boolean; updated_at: string; category: { name: string } | null; variants: { count: number }[] };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-espresso">Products</h1>
          <p className="text-sm text-muted">{rows.length} shown</p>
        </div>
        {staff.permissions.includes("products.write") ? (
          <Link href="/admin/products/new" className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream">
            New product
          </Link>
        ) : null}
      </header>
      <form className="flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search products</label>
        <input id="q" name="q" defaultValue={q} placeholder="Search by title" className="rounded border border-line bg-white px-3 py-2 text-sm" />
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={status} className="rounded border border-line bg-white px-3 py-2 text-sm">
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <button className="rounded border border-line bg-white px-3 py-2 text-sm">Filter</button>
      </form>
      {error ? <p role="alert" className="text-danger">Could not load products.</p> : null}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Products</caption>
          <thead className="border-b border-line bg-cream text-xs uppercase tracking-wider text-muted">
            <tr>
              <th scope="col" className="px-4 py-3">Title</th>
              <th scope="col" className="px-4 py-3">Category</th>
              <th scope="col" className="px-4 py-3">Variants</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No products found.</td></tr>
            ) : rows.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <Link href={`/admin/products/${p.id}`} className="font-medium text-espresso hover:underline">{p.title}</Link>
                  {p.is_demo ? <span className="ml-2 text-[10px] uppercase text-bronze-strong">demo</span> : null}
                </td>
                <td className="px-4 py-3">{p.category?.name ?? "—"}</td>
                <td className="px-4 py-3">{p.variants[0]?.count ?? 0}</td>
                <td className="px-4 py-3"><StatusPill status={p.status} /></td>
                <td className="px-4 py-3 text-muted">{new Date(p.updated_at).toLocaleDateString("en-GB")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls = status === "active" ? "bg-success/10 text-success" : status === "draft" ? "bg-bronze/10 text-bronze-strong" : "bg-charcoal/10 text-charcoal";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}
