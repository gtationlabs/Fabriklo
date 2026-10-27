import Link from "next/link";
import { PurchaseOrderForm } from "@/components/admin/document-forms";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewPurchaseOrderPage() {
  const staff = await requireStaff("inventory.adjust");
  const supabase = await createSupabaseServerClient();
  const { data: warehouses } = await supabase.from("warehouses").select("id, name").eq("is_active", true).order("is_default", { ascending: false });
  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <Link href="/admin/inventory/purchase-orders" className="text-sm text-muted hover:underline">← Purchase orders</Link>
        <h1 className="font-display text-3xl font-semibold text-espresso">New purchase order</h1>
      </header>
      <PurchaseOrderForm draft={{ id: null, supplier_name: "", supplier_ref: "", warehouse_id: "", expected_at: "", note: "", lines: [] }} warehouses={warehouses ?? []} canCost={staff.permissions.includes("products.costs")} />
    </div>
  );
}
