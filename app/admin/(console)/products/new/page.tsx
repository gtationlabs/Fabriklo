import { ProductForm } from "@/components/admin/product-form";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createProduct } from "../actions";

export default async function NewProductPage() {
  await requireStaff("products.write");
  const supabase = await createSupabaseServerClient();
  const { data: categories } = await supabase.from("categories").select("id, name").order("position");
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-semibold text-espresso">New product</h1>
      <p className="text-sm text-muted">Products start as drafts. Add variants and stock, then publish.</p>
      <ProductForm action={createProduct} categories={categories ?? []} mode="create" />
    </div>
  );
}
