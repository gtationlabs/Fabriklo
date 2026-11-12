import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { SettingsPanel, SettingsRow, TextArea, TextField, Toggle } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveInvoiceSettings } from "../hub-actions";

export const metadata: Metadata = { title: "Invoice & packing slip" };

export default async function InvoiceSettings() {
  await requireStaff("settings.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: last }] = await Promise.all([
    supabase.from("site_settings").select("value").eq("key", "store.invoice").maybeSingle(),
    supabase.from("orders").select("id").order("placed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const v = (data?.value ?? {}) as { legal_name?: string; bin?: string; header_note?: string; footer_note?: string; return_policy?: string; show_sku?: boolean; packing_slip_prices?: boolean };
  return (
    <ActionForm action={saveInvoiceSettings} label="Invoice settings" submitLabel="Save invoice settings">
      <SettingsPanel title="Invoice & packing slip" description="What prints on the invoice and the packing slip that goes in the parcel. Print them from any order." icon={<ReceiptText className="size-5" aria-hidden />}>
        <SettingsRow title="Business details" description="Legal name and VAT registration (BIN), if you have one.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Legal business name" name="legal_name" defaultValue={v.legal_name} maxLength={120} />
            <TextField label="BIN (VAT registration)" name="bin" defaultValue={v.bin} maxLength={13} inputMode="numeric" />
          </div>
        </SettingsRow>
        <SettingsRow title="Text" description="A short note at the top, your returns policy, and a thank-you at the bottom.">
          <TextField label="Header note" name="header_note" defaultValue={v.header_note} maxLength={200} />
          <TextArea label="Returns policy" name="return_policy" defaultValue={v.return_policy} maxLength={600} />
          <TextField label="Footer note" name="footer_note" defaultValue={v.footer_note} maxLength={300} />
        </SettingsRow>
        <SettingsRow title="Layout">
          <Toggle label="Show SKU codes" name="show_sku" defaultChecked={v.show_sku ?? true} />
          <Toggle label="Show prices on the packing slip" name="packing_slip_prices" defaultChecked={v.packing_slip_prices ?? false} hint="Off is safer for gifts." />
          {last ? (
            <p className="text-sm">Preview with the latest order: <Link href={`/admin/orders/${last.id}/invoice`} target="_blank" className="underline">invoice</Link> · <Link href={`/admin/orders/${last.id}/invoice?slip=1`} target="_blank" className="underline">packing slip</Link></p>
          ) : null}
        </SettingsRow>
      </SettingsPanel>
    </ActionForm>
  );
}
