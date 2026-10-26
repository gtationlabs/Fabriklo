import "server-only";
import type { TemplateKeys } from "@/components/admin/marketing-forms";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function loadRuleFormData(): Promise<{ templates: TemplateKeys; allowlist: string[] }> {
  const supabase = await createSupabaseServerClient();
  const [e, s, w, a] = await Promise.all([
    supabase.from("email_templates").select("key").order("key"),
    supabase.from("sms_templates").select("key").order("key"),
    supabase.from("whatsapp_templates").select("key").order("key"),
    supabase.from("site_settings").select("value").eq("key", "automation.webhook_allowlist").maybeSingle(),
  ]);
  return {
    templates: { email: (e.data ?? []).map((r) => r.key), sms: (s.data ?? []).map((r) => r.key), whatsapp: (w.data ?? []).map((r) => r.key) },
    allowlist: (((a.data?.value as { hosts?: string[] } | null)?.hosts) ?? []).filter((h) => typeof h === "string"),
  };
}
