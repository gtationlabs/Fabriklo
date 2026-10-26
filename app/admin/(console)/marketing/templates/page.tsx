import { TemplateForm, type TemplateRow } from "@/components/admin/marketing-forms";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VARS = "store_name, site_url, order_number, customer_name, total, payment_method, payment_status, district, item_count, coupon_code, sku, product_title, available, event_type, title, note, severity, rule_name, campaign_name, week, orders, confirm_url, unsubscribe_url, track_url";

export default async function TemplatesPage() {
  const staff = await requireStaff("marketing.read");
  const supabase = await createSupabaseServerClient();
  const [email, sms, wa] = await Promise.all([
    supabase.from("email_templates").select("*").order("key"),
    supabase.from("sms_templates").select("*").order("key"),
    supabase.from("whatsapp_templates").select("*").order("key"),
  ]);
  const canManage = staff.permissions.includes("marketing.manage");
  const section = (kind: "email" | "sms" | "whatsapp", title: string, rows: TemplateRow[]) => (
    <section className="space-y-4">
      <h2 className="font-semibold text-espresso">{title}</h2>
      {rows.map((t) => (
        <details key={t.key} className="rounded border border-line bg-white p-3">
          <summary className="cursor-pointer text-sm"><span className="font-mono">{t.key}</span> · {t.name} <span className="text-xs text-muted">({t.message_class})</span></summary>
          <div className="mt-3">{canManage ? <TemplateForm kind={kind} template={t} /> : <pre className="whitespace-pre-wrap text-xs">{t.subject ? `Subject: ${t.subject}\n\n` : ""}{t.body_text ?? t.provider_template_name}</pre>}</div>
        </details>
      ))}
      {canManage ? (
        <details className="rounded border border-dashed border-line p-3"><summary className="cursor-pointer text-sm">Add a {kind} template</summary><div className="mt-3"><TemplateForm kind={kind} template={null} /></div></details>
      ) : null}
    </section>
  );
  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-semibold text-espresso">Message templates</h1>
      <p className="text-xs text-muted">Plain text only, no HTML. Placeholders: <code className="text-[11px]">{VARS}</code>. Unknown placeholders render empty. Marketing emails always get an unsubscribe link.</p>
      {section("email", "Email", (email.data ?? []) as TemplateRow[])}
      {section("sms", "SMS", (sms.data ?? []) as TemplateRow[])}
      {section("whatsapp", "WhatsApp (provider-approved templates)", (wa.data ?? []) as TemplateRow[])}
    </div>
  );
}
