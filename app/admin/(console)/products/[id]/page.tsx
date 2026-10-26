import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/admin/product-form";
import { AddVariantForm, VariantRow, type VariantRowData } from "@/components/admin/variant-editor";
import { requireStaff } from "@/lib/auth/staff";
import { compareSizes } from "@/lib/catalog/sizes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addVariant, adjustStock, updateProduct, updateVariant } from "../actions";

export default async function EditProductPage({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  const staff = await requireStaff("products.read");
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const can = (p: string) => staff.permissions.includes(p as never);
  const [{ data: product }, { data: categories }, { data: warehouses }] = await Promise.all([
    supabase
      .from("products")
      .select("id, title, slug, subtitle, description, materials, care, category_id, audience, status, featured, tags, seo_title, seo_description, is_demo, published_at, variants:product_variants(id, sku, size, color, color_hex, price_minor, compare_at_minor, is_active)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("categories").select("id, name").order("position"),
    can("inventory.read") ? supabase.from("warehouses").select("id, name").eq("is_active", true).order("is_default", { ascending: false }) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  if (!product) notFound();

  type V = { id: string; sku: string; size: string; color: string; color_hex: string | null; price_minor: number; compare_at_minor: number | null; is_active: boolean };
  const variants = (product.variants as V[]).sort((a, b) => a.color.localeCompare(b.color) || compareSizes(a.size, b.size));
  const ids = variants.map((v) => v.id);

  const [{ data: balances }, { data: costs }] = await Promise.all([
    can("inventory.read") && ids.length
      ? supabase.from("stock_balances").select("variant_id, warehouse_id, on_hand, reserved, warehouse:warehouses(name)").in("variant_id", ids)
      : Promise.resolve({ data: [] }),
    can("products.costs") && ids.length ? supabase.from("variant_costs").select("variant_id, cost_minor").in("variant_id", ids) : Promise.resolve({ data: [] }),
  ]);
  type B = { variant_id: string; warehouse_id: string; on_hand: number; reserved: number; warehouse: { name: string } | null };
  const costBy = new Map(((costs ?? []) as { variant_id: string; cost_minor: number }[]).map((c) => [c.variant_id, c.cost_minor]));
  const rows: VariantRowData[] = variants.map((v) => ({
    ...v,
    cost_minor: costBy.get(v.id) ?? null,
    stock: ((balances ?? []) as unknown as B[])
      .filter((b) => b.variant_id === v.id)
      .map((b) => ({ warehouse_id: b.warehouse_id, warehouse: b.warehouse?.name ?? "", on_hand: b.on_hand, reserved: b.reserved })),
  }));
  const canWrite = can("products.write");

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin/products" className="text-sm text-muted hover:underline">← Products</Link>
          <h1 className="font-display text-3xl font-semibold text-espresso">{product.title}</h1>
          <p className="text-sm text-muted">
            Status: <strong>{product.status}</strong>
            {product.is_demo ? " · demo product" : ""}
            {product.status === "active" ? (
              <>
                {" · "}
                <Link href={`/product/${product.slug}`} className="underline" target="_blank">View in shop</Link>
              </>
            ) : null}
          </p>
        </div>
      </header>
      {created ? <p role="status" className="rounded bg-success/10 p-3 text-sm text-success">Draft created. Add variants and stock, then set the status to Active to publish.</p> : null}

      <section aria-labelledby="details-heading" className="max-w-3xl">
        <h2 id="details-heading" className="mb-4 text-lg font-semibold text-espresso">Details</h2>
        {canWrite ? (
          <ProductForm action={updateProduct.bind(null, product.id)} categories={categories ?? []} product={product} mode="edit" />
        ) : (
          <p className="text-sm text-muted">Read-only: you do not have permission to edit products.</p>
        )}
      </section>

      <section aria-labelledby="variants-heading">
        <h2 id="variants-heading" className="mb-4 text-lg font-semibold text-espresso">Variants & stock</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-white px-4">
          <table className="w-full text-left">
            <caption className="sr-only">Variants</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="py-3 pr-3">SKU</th>
                <th scope="col" className="py-3 pr-3">Price</th>
                <th scope="col" className="py-3 pr-3">Stock</th>
                <th scope="col" className="py-3">Inventory</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="py-6 text-center text-sm text-muted">No variants yet.</td></tr>
              ) : rows.map((v) => (
                <VariantRow
                  key={v.id}
                  v={v}
                  updateAction={updateVariant.bind(null, v.id, product.id)}
                  adjustAction={adjustStock.bind(null, v.id, product.id)}
                  canAdjust={can("inventory.adjust")}
                  warehouses={warehouses ?? []}
                  newIdempotencyKey={randomUUID()}
                />
              ))}
            </tbody>
          </table>
        </div>
        {canWrite ? (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-espresso">Add a variant</h3>
            <AddVariantForm action={addVariant.bind(null, product.id)} canCost={can("products.costs")} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
