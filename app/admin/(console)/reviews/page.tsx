import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, EmptyState, PageHeader, SelectField, TextArea, TextField, Toggle } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteReview, importReview, moderateReview } from "./actions";

export const metadata: Metadata = { title: "Reviews" };

type Review = {
  id: string; product_id: string; author_name: string; author_city: string; rating: number; title: string; body: string;
  status: "pending" | "approved" | "rejected"; source: "customer" | "imported"; verified_purchase: boolean; is_featured: boolean;
  staff_reply: string | null; fit: string | null; size_bought: string | null; created_at: string;
  products: { title: string; slug: string } | null;
};
const STATUSES = ["pending", "approved", "rejected"] as const;
const TONE = { pending: "warn", approved: "good", rejected: "bad" } as const;

export default async function ReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requireStaff("reviews.moderate");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "pending";
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: counts }, { data: products }] = await Promise.all([
    supabase.from("product_reviews").select("*, products(title, slug)").eq("status", status).order("created_at", { ascending: false }).limit(100),
    supabase.from("product_reviews").select("status, rating, is_featured"),
    supabase.from("products").select("id, title").neq("status", "archived").order("title").limit(500),
  ]);
  const reviews = (data ?? []) as Review[];
  const all = (counts ?? []) as { status: Review["status"]; rating: number; is_featured: boolean }[];
  const n = (s: string) => all.filter((r) => r.status === s).length;
  const approved = all.filter((r) => r.status === "approved");
  const avg = approved.length ? approved.reduce((s, r) => s + r.rating, 0) / approved.length : null;
  const featured = all.filter((r) => r.is_featured).length;

  return (
    <div>
      <PageHeader
        title="Reviews"
        description="Customers review products from the product page; nothing appears until it is approved here. Feature at least three approved reviews to replace the sample reviews on the home page."
      />
      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/reviews?status=${s}`} className={`rounded-xl border bg-white p-4 ${status === s ? "border-espresso" : "border-line"}`}>
            <dt className="text-xs uppercase tracking-wider text-muted">{s}</dt>
            <dd className="mt-1 text-2xl font-semibold text-espresso">{n(s)}</dd>
          </Link>
        ))}
        <div className="rounded-xl border border-line bg-white p-4"><dt className="text-xs uppercase tracking-wider text-muted">Average rating</dt><dd className="mt-1 text-2xl font-semibold text-espresso">{avg ? `${avg.toFixed(1)} ★` : "—"}</dd></div>
        <div className="rounded-xl border border-line bg-white p-4"><dt className="text-xs uppercase tracking-wider text-muted">On the home page</dt><dd className="mt-1 text-2xl font-semibold text-espresso">{featured >= 3 ? featured : `${featured} / 3`}</dd></div>
      </dl>

      {reviews.length === 0 ? <EmptyState>No {status} reviews.</EmptyState> : null}
      <ul className="space-y-3" data-testid="reviews-list">
        {reviews.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-bronze" aria-label={`${r.rating} stars`}>{"★".repeat(r.rating)}<span className="text-sand">{"★".repeat(5 - r.rating)}</span></span>
              {r.title ? <strong className="text-espresso">{r.title}</strong> : null}
              <Badge tone={TONE[r.status]}>{r.status}</Badge>
              {r.verified_purchase ? <Badge tone="good">Verified purchase</Badge> : null}
              {r.source === "imported" ? <Badge tone="info">Added by staff</Badge> : null}
              {r.is_featured ? <Badge tone="info">Featured</Badge> : null}
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-charcoal">{r.body}</p>
            <p className="mt-2 text-xs text-muted">
              {r.author_name}{r.author_city ? `, ${r.author_city}` : ""} on{" "}
              {r.products ? <Link href={`/product/${r.products.slug}`} className="underline">{r.products.title}</Link> : "a removed product"}
              {r.size_bought ? ` · size ${r.size_bought}` : ""}{r.fit ? ` · fit: ${r.fit === "true" ? "true to size" : `runs ${r.fit}`}` : ""} · {new Date(r.created_at).toLocaleDateString("en-GB")}
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <ActionForm action={moderateReview.bind(null, r.id)} label={`Moderate review by ${r.author_name}`} submitLabel="Save" className="grid flex-1 gap-3 md:grid-cols-[160px_1fr_auto] md:items-end">
                <SelectField label="Status" name="status" defaultValue={r.status === "pending" ? "approved" : r.status} options={STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))} />
                <TextField label="Public reply (optional)" name="staff_reply" defaultValue={r.staff_reply} maxLength={1000} />
                <Toggle label="Feature on home page" name="is_featured" defaultChecked={r.is_featured} />
              </ActionForm>
              <ActionForm action={deleteReview.bind(null, r.id)} label={`Delete review by ${r.author_name}`} submitLabel="Delete" danger compact confirm="Delete this review for good?" />
            </div>
          </li>
        ))}
      </ul>

      <Card title="Add a review from another channel" description="For real feedback customers sent on Facebook, WhatsApp or in the store. It is labelled as added by staff and is never shown as a verified purchase." className="mt-8">
        <ActionForm action={importReview} label="Add review" submitLabel="Add review">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <SelectField label="Product" name="product_id" className="md:col-span-2" options={[{ value: "", label: "Choose a product" }, ...((products ?? []) as { id: string; title: string }[]).map((p) => ({ value: p.id, label: p.title }))]} />
            <TextField label="Customer name" name="author_name" required maxLength={60} placeholder="Nusrat J." />
            <TextField label="City" name="author_city" maxLength={40} placeholder="Dhaka" />
            <SelectField label="Rating" name="rating" defaultValue="5" options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} stars` }))} />
            <TextField label="Size bought" name="size_bought" maxLength={20} />
            <SelectField label="Fit" name="fit" options={[{ value: "", label: "Not given" }, { value: "true", label: "True to size" }, { value: "small", label: "Runs small" }, { value: "large", label: "Runs large" }]} />
            <TextField label="Title" name="title" maxLength={120} />
            <TextArea label="Review" name="body" required maxLength={2000} className="md:col-span-2 lg:col-span-4" />
            <div className="md:col-span-2"><Toggle label="A real customer wrote this" name="confirm_real" hint="Never add made-up reviews." /></div>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
