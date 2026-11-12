import type { Metadata } from "next";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, Card, EmptyState, PageHeader, SelectField, TextArea, TextField, Toggle } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteCategory, saveCategory } from "./actions";

export const metadata: Metadata = { title: "Categories" };

type Cat = { id: string; parent_id: string | null; slug: string; name: string; description: string; position: number; is_active: boolean };

function CategoryFields({ c, parents }: { c: Cat | null; parents: Cat[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <TextField label="Name" name="name" defaultValue={c?.name} required maxLength={80} />
      <TextField label="Slug" name="slug" defaultValue={c?.slug} maxLength={80} hint={c ? undefined : "Leave empty to build it from the name."} />
      <SelectField label="Parent" name="parent_id" defaultValue={c?.parent_id ?? ""} options={[{ value: "", label: "None (top level)" }, ...parents.filter((p) => p.id !== c?.id).map((p) => ({ value: p.id, label: p.name }))]} />
      <TextField label="Position" name="position" type="number" min={0} max={9999} defaultValue={c?.position ?? 0} />
      <TextArea label="Description" name="description" defaultValue={c?.description} maxLength={2000} rows={2} className="sm:col-span-2 lg:col-span-3" />
      <Toggle label="Visible in the shop" name="is_active" defaultChecked={c?.is_active ?? true} />
    </div>
  );
}

export default async function CategoriesPage() {
  const staff = await requireStaff("products.read");
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: counts }] = await Promise.all([
    supabase.from("categories").select("id, parent_id, slug, name, description, position, is_active").order("position").order("name"),
    supabase.from("products").select("category_id").neq("status", "archived"),
  ]);
  const cats = (data ?? []) as Cat[];
  const productCount = new Map<string, number>();
  for (const p of (counts ?? []) as { category_id: string | null }[]) if (p.category_id) productCount.set(p.category_id, (productCount.get(p.category_id) ?? 0) + 1);
  const canWrite = staff.permissions.includes("products.write");
  const byId = new Map(cats.map((c) => [c.id, c]));
  const tops = cats.filter((c) => !c.parent_id);
  const ordered = tops.flatMap((t) => [t, ...cats.filter((c) => c.parent_id === t.id)]);
  const orphans = cats.filter((c) => c.parent_id && !byId.get(c.parent_id));

  return (
    <div>
      <PageHeader title="Categories" description="Product categories used for navigation, filters and the home page rows. Hidden categories stay attached to their products but disappear from the shop." />
      {canWrite ? (
        <Card title="Add a category" className="mb-6">
          <ActionForm action={saveCategory.bind(null, null)} label="New category" submitLabel="Create category">
            <CategoryFields c={null} parents={tops} />
          </ActionForm>
        </Card>
      ) : null}
      {cats.length === 0 ? <EmptyState>No categories yet.</EmptyState> : null}
      <ul className="space-y-3" data-testid="categories-list">
        {[...ordered, ...orphans].map((c) => (
          <li key={c.id} className={`rounded-xl border border-line bg-white ${c.parent_id ? "ml-6" : ""}`}>
            <details>
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3">
                <span className="font-medium text-espresso">{c.parent_id ? "↳ " : ""}{c.name}</span>
                <span className="font-mono text-xs text-muted">/{c.slug}</span>
                <Badge tone={c.is_active ? "good" : "neutral"}>{c.is_active ? "Visible" : "Hidden"}</Badge>
                <span className="ml-auto text-xs text-muted">{productCount.get(c.id) ?? 0} products</span>
              </summary>
              {canWrite ? (
                <div className="space-y-3 border-t border-line p-5">
                  <ActionForm action={saveCategory.bind(null, c.id)} label={`Category: ${c.name}`} submitLabel="Save category">
                    <CategoryFields c={c} parents={tops} />
                  </ActionForm>
                  <ActionForm action={deleteCategory.bind(null, c.id)} label={`Delete ${c.name}`} submitLabel="Delete" danger compact confirm={`Delete the category “${c.name}”?`} />
                </div>
              ) : (
                <p className="border-t border-line p-5 text-sm text-muted">{c.description || "No description."}</p>
              )}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
