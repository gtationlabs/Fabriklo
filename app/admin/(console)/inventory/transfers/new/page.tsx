import Link from "next/link";
import { TransferForm } from "@/components/admin/document-forms";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewTransferPage() {
  await requireStaff("inventory.adjust");
  const supabase = await createSupabaseServerClient();
  const { data: warehouses } = await supabase.from("warehouses").select("id, name").eq("is_active", true).order("is_default", { ascending: false });
  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <Link href="/admin/inventory/transfers" className="text-sm text-muted hover:underline">← Transfers</Link>
        <h1 className="font-display text-3xl font-semibold text-espresso">New transfer</h1>
        {(warehouses ?? []).length < 2 ? <p className="mt-2 text-sm text-danger">Transfers need at least two active warehouses.</p> : null}
      </header>
      <TransferForm draft={{ id: null, from_warehouse_id: "", to_warehouse_id: "", note: "", lines: [] }} warehouses={warehouses ?? []} />
    </div>
  );
}
