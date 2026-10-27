"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAutomationTick } from "@/lib/automation/service";
import { checkStaff } from "@/lib/auth/staff";
import { friendlyDbError } from "@/lib/db-errors";
import { CONDITION_OPS as OPS, TRIGGERS } from "@/lib/marketing/constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string | null; id?: string };
const idle: ActionState = { ok: false, message: null };
const UUID = z.string().uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => (str(fd, k) === "" ? null : Number(str(fd, k)));
const dt = (fd: FormData, k: string) => (str(fd, k) ? new Date(str(fd, k)).toISOString() : null);

// ---------------------------------------------------------------------------
// Promotions (coupons + automatic discounts): direct table writes through RLS.
// ---------------------------------------------------------------------------
const promotionSchema = z
  .object({
    kind: z.enum(["coupon", "automatic"]),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$|^$/, "3–32 letters, digits, - or _"),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    discount_type: z.enum(["percent", "fixed", "free_shipping"]),
    discount_value: z.coerce.number().int().min(0),
    max_discount_minor: z.coerce.number().int().positive().nullable(),
    scope: z.enum(["order", "categories", "collections", "variants"]),
    target_ids: z.array(UUID).max(200),
    min_subtotal_minor: z.coerce.number().int().min(0),
    first_order_only: z.boolean(),
    once_per_customer: z.boolean(),
    max_redemptions: z.coerce.number().int().positive().nullable(),
    priority: z.coerce.number().int().min(-1000).max(1000),
    stackable: z.boolean(),
    starts_at: z.string().nullable(),
    ends_at: z.string().nullable(),
    is_active: z.boolean(),
  })
  .refine((p) => p.kind !== "coupon" || p.code.length > 0, { path: ["code"], message: "Coupons need a code" })
  .refine((p) => p.scope === "order" || p.target_ids.length > 0, { path: ["target_ids"], message: "Pick at least one target" })
  .refine((p) => p.discount_type !== "percent" || (p.discount_value >= 1 && p.discount_value <= 100), { path: ["discount_value"], message: "Percent must be 1–100" })
  .refine((p) => p.discount_type !== "fixed" || p.discount_value > 0, { path: ["discount_value"], message: "Enter the amount" });

export async function savePromotion(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return { ...idle, message: auth.message };
  const discountType = str(fd, "discount_type");
  const parsed = promotionSchema.safeParse({
    kind: str(fd, "kind"),
    code: str(fd, "kind") === "coupon" ? str(fd, "code") : "",
    name: str(fd, "name"),
    description: str(fd, "description") || undefined,
    discount_type: discountType,
    // Fixed amounts are entered in taka and stored in poisha (integer minor units).
    discount_value: discountType === "fixed" ? Math.round(Number(str(fd, "discount_value") || 0) * 100) : discountType === "percent" ? num(fd, "discount_value") ?? 0 : 0,
    max_discount_minor: num(fd, "max_discount") == null ? null : Math.round(Number(num(fd, "max_discount")) * 100),
    scope: str(fd, "scope"),
    target_ids: str(fd, "scope") === "order" ? [] : fd.getAll("target_ids").map(String).filter(Boolean),
    min_subtotal_minor: Math.round(Number(str(fd, "min_subtotal") || 0) * 100),
    first_order_only: fd.get("first_order_only") === "on",
    once_per_customer: fd.get("once_per_customer") === "on",
    max_redemptions: num(fd, "max_redemptions"),
    priority: num(fd, "priority") ?? 100,
    stackable: fd.get("stackable") === "on",
    starts_at: dt(fd, "starts_at"),
    ends_at: dt(fd, "ends_at"),
    is_active: fd.get("is_active") === "on",
  });
  if (!parsed.success) return { ...idle, message: parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`).join("; ") };
  const row = { ...parsed.data, code: parsed.data.kind === "coupon" ? parsed.data.code : null };
  const supabase = await createSupabaseServerClient();
  if (id) {
    const { error } = await supabase.from("promotions").update(row).eq("id", id);
    if (error) return { ...idle, message: friendlyDbError(error) };
    revalidatePath("/admin/marketing/coupons");
    return { ok: true, message: "Saved.", id };
  }
  const { data, error } = await supabase.from("promotions").insert(row).select("id").single();
  if (error) return { ...idle, message: friendlyDbError(error) };
  revalidatePath("/admin/marketing/coupons");
  redirect(`/admin/marketing/coupons/${data.id}`);
}

export async function deletePromotion(id: string): Promise<void> {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return;
  const supabase = await createSupabaseServerClient();
  // Promotions with redemptions are kept (restrict FK); deactivate instead.
  const { error } = await supabase.from("promotions").delete().eq("id", id);
  if (error) await supabase.from("promotions").update({ is_active: false }).eq("id", id);
  revalidatePath("/admin/marketing/coupons");
  redirect("/admin/marketing/coupons");
}

// ---------------------------------------------------------------------------
// Newsletter suppressions
// ---------------------------------------------------------------------------
export async function addSuppression(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return { ...idle, message: auth.message };
  const parsed = z
    .object({ identifier: z.string().trim().toLowerCase().min(3).max(254), channel: z.enum(["email", "sms", "whatsapp", "all"]), reason: z.string().trim().max(200).optional() })
    .safeParse({ identifier: str(fd, "identifier"), channel: str(fd, "channel"), reason: str(fd, "reason") || undefined });
  if (!parsed.success) return { ...idle, message: "Enter an email or phone and a channel." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("unsubscribes").upsert(parsed.data, { onConflict: "identifier,channel" });
  if (error) return { ...idle, message: friendlyDbError(error) };
  revalidatePath("/admin/marketing/newsletter");
  return { ok: true, message: "Added to the suppression list." };
}

export async function removeSuppression(id: number): Promise<void> {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("unsubscribes").delete().eq("id", id);
  revalidatePath("/admin/marketing/newsletter");
}

// ---------------------------------------------------------------------------
// Templates (text only)
// ---------------------------------------------------------------------------
export async function saveTemplate(kind: "email" | "sms" | "whatsapp", key: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return { ...idle, message: auth.message };
  const base = z.object({
    key: z.string().regex(/^[a-z0-9_]{3,60}$/, "key: lowercase letters, digits, underscores"),
    name: z.string().trim().min(2).max(120),
    message_class: z.enum(["transactional", "marketing"]),
  });
  const supabase = await createSupabaseServerClient();
  const table = kind === "email" ? "email_templates" : kind === "sms" ? "sms_templates" : "whatsapp_templates";
  let row: Record<string, unknown>;
  if (kind === "email") {
    const p = base.extend({ subject: z.string().trim().min(1).max(200), body_text: z.string().min(1).max(10000) }).safeParse({ key: key ?? str(fd, "key"), name: str(fd, "name"), message_class: str(fd, "message_class"), subject: str(fd, "subject"), body_text: String(fd.get("body_text") ?? "") });
    if (!p.success) return { ...idle, message: p.error.issues.map((i) => i.message).join("; ") };
    row = p.data;
  } else if (kind === "sms") {
    const p = base.extend({ body_text: z.string().trim().min(1).max(480) }).safeParse({ key: key ?? str(fd, "key"), name: str(fd, "name"), message_class: str(fd, "message_class"), body_text: String(fd.get("body_text") ?? "") });
    if (!p.success) return { ...idle, message: p.error.issues.map((i) => i.message).join("; ") };
    row = p.data;
  } else {
    const p = base
      .extend({ provider_template_name: z.string().trim().min(1).max(120), language_code: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/), variables: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(20) })
      .safeParse({ key: key ?? str(fd, "key"), name: str(fd, "name"), message_class: str(fd, "message_class"), provider_template_name: str(fd, "provider_template_name"), language_code: str(fd, "language_code") || "en", variables: str(fd, "variables").split(",").map((v) => v.trim()).filter(Boolean) });
    if (!p.success) return { ...idle, message: p.error.issues.map((i) => i.message).join("; ") };
    row = p.data;
  }
  if (/<[a-z!/]/i.test(String(row.body_text ?? "") + String(row.subject ?? ""))) return { ...idle, message: "Templates are plain text: HTML tags are not allowed." };
  const { error } = key ? await supabase.from(table).update(row).eq("key", key) : await supabase.from(table).insert(row);
  if (error) return { ...idle, message: friendlyDbError(error) };
  revalidatePath("/admin/marketing/templates");
  return { ok: true, message: "Template saved." };
}

// ---------------------------------------------------------------------------
// Automation rules
// ---------------------------------------------------------------------------

function parseConditions(fd: FormData) {
  const fields = fd.getAll("cond_field").map(String);
  const ops = fd.getAll("cond_op").map(String);
  const values = fd.getAll("cond_value").map(String);
  const out: { field: string; op: string; value?: unknown }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!.trim();
    if (!field) continue;
    const op = ops[i] ?? "eq";
    const raw = (values[i] ?? "").trim();
    let value: unknown = raw;
    if (op === "in") value = raw.split(",").map((v) => v.trim()).filter(Boolean).map((v) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v));
    else if (/^-?\d+(\.\d+)?$/.test(raw)) value = Number(raw);
    else if (raw === "true" || raw === "false") value = raw === "true";
    out.push(op === "exists" || op === "not_exists" ? { field, op } : { field, op, value });
  }
  return out;
}

function parseAction(fd: FormData) {
  const type = str(fd, "action_type");
  const messageClass = str(fd, "message_class") || "transactional";
  switch (type) {
    case "email":
      return { type, template_key: str(fd, "template_key"), to: str(fd, "to") || "customer", staff_email: str(fd, "staff_email") || undefined, message_class: messageClass };
    case "sms":
    case "whatsapp":
      return { type, template_key: str(fd, "template_key"), message_class: messageClass };
    case "webhook":
      return { type, url: str(fd, "url"), event_name: str(fd, "event_name") || undefined };
    default:
      return { type, title: str(fd, "title"), note: str(fd, "note") || undefined, severity: str(fd, "severity") || "info" };
  }
}

export async function saveRule(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("automation.manage");
  if (!auth.ok) return { ...idle, message: auth.message };
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().max(500).optional(),
      trigger_type: z.enum(TRIGGERS),
      conditions: z.array(z.object({ field: z.string().regex(/^[a-z0-9_.]{1,60}$/), op: z.enum(OPS), value: z.unknown().optional() })).max(20),
      action: z.record(z.string(), z.unknown()),
      mode: z.enum(["dry_run", "live"]),
      quota_per_hour: z.coerce.number().int().min(1).max(10000),
      is_active: z.boolean(),
    })
    .safeParse({
      name: str(fd, "name"),
      description: str(fd, "description") || undefined,
      trigger_type: str(fd, "trigger_type"),
      conditions: parseConditions(fd),
      action: parseAction(fd),
      mode: str(fd, "mode") || "dry_run",
      quota_per_hour: str(fd, "quota_per_hour") || 100,
      is_active: fd.get("is_active") === "on",
    });
  if (!parsed.success) return { ...idle, message: parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`).join("; ") };
  const supabase = await createSupabaseServerClient();
  if (id) {
    const { error } = await supabase.from("automation_rules").update(parsed.data).eq("id", id);
    if (error) return { ...idle, message: ruleError(error) };
    revalidatePath(`/admin/marketing/rules/${id}`);
    revalidatePath("/admin/marketing/rules");
    return { ok: true, message: "Rule saved (new version recorded).", id };
  }
  const { data, error } = await supabase.from("automation_rules").insert(parsed.data).select("id").single();
  if (error) return { ...idle, message: ruleError(error) };
  revalidatePath("/admin/marketing/rules");
  redirect(`/admin/marketing/rules/${data.id}`);
}

function ruleError(error: { code?: string; message?: string; hint?: string }) {
  if (error.hint === "webhook_host_denied") return "That webhook host is not on the allowlist (Integrations → Webhook allowlist).";
  if (error.code === "22023" && error.message) return error.message.replace(/^.*?:\s*/, "").slice(0, 160);
  return friendlyDbError(error);
}

export async function deleteRule(id: string): Promise<void> {
  const auth = await checkStaff("automation.manage");
  if (!auth.ok) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("automation_rules").delete().eq("id", id);
  revalidatePath("/admin/marketing/rules");
  redirect("/admin/marketing/rules");
}

export async function toggleRule(id: string, active: boolean): Promise<void> {
  const auth = await checkStaff("automation.manage");
  if (!auth.ok) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("automation_rules").update({ is_active: active }).eq("id", id);
  revalidatePath("/admin/marketing/rules");
  revalidatePath(`/admin/marketing/rules/${id}`);
}

export type TestResult = { ok: boolean; message: string | null; rows: { event_id: number; occurred_at: string; matches: boolean; recipient: string | null; marketing_allowed: boolean | null; summary: Record<string, unknown> }[] };

export async function testRule(id: string, prev: TestResult, fd: FormData): Promise<TestResult> {
  void prev;
  void fd;
  const auth = await checkStaff("automation.manage");
  if (!auth.ok) return { ok: false, message: auth.message, rows: [] };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("automation_test_rule", { p_rule_id: id, p_limit: 10 });
  if (error) return { ok: false, message: friendlyDbError(error), rows: [] };
  const rows = (data ?? []) as TestResult["rows"];
  return { ok: true, message: rows.length ? `Checked the last ${rows.length} events of this trigger. Nothing was sent.` : "No events of this type yet. Nothing was sent.", rows };
}

// ---------------------------------------------------------------------------
// Outbox, worker and settings
// ---------------------------------------------------------------------------
export async function retryOutbox(id: string): Promise<void> {
  const auth = await checkStaff("automation.manage");
  if (!auth.ok) return;
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("admin_outbox_retry", { p_id: id });
  revalidatePath("/admin/marketing/outbox");
}

export async function runAutomationNow(): Promise<void> {
  const auth = await checkStaff("automation.manage");
  if (!auth.ok) return;
  await runAutomationTick({ events: 500, messages: 50 }).catch(() => undefined);
  revalidatePath("/admin/marketing");
  revalidatePath("/admin/marketing/outbox");
  revalidatePath("/admin/marketing/rules");
}

export async function saveBanner(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return { ...idle, message: auth.message };
  const value = { enabled: fd.get("enabled") === "on", text: str(fd, "text").slice(0, 200), href: str(fd, "href"), starts_at: dt(fd, "starts_at"), ends_at: dt(fd, "ends_at") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_marketing_setting", { p_key: "marketing.banner", p_value: value });
  if (error) return { ...idle, message: friendlyDbError(error) };
  revalidatePath("/admin/marketing");
  revalidatePath("/", "layout");
  return { ok: true, message: "Banner saved." };
}

export async function saveWebhookAllowlist(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("automation.manage");
  if (!auth.ok) return { ...idle, message: auth.message };
  const hosts = str(fd, "hosts").split(/[\s,]+/).map((h) => h.trim().toLowerCase()).filter(Boolean);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_update_marketing_setting", { p_key: "automation.webhook_allowlist", p_value: { hosts } });
  if (error) return { ...idle, message: error.code === "22023" ? (error.message ?? "Invalid host").slice(0, 160) : friendlyDbError(error) };
  revalidatePath("/admin/marketing/integrations");
  return { ok: true, message: "Allowlist saved." };
}

export async function saveIntegration(provider: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("integrations.manage");
  if (!auth.ok) return { ...idle, message: auth.message };
  const parsed = z
    .object({
      status: z.enum(["not_configured", "configured", "disabled"]),
      secret_env: z.string().regex(/^[A-Z][A-Z0-9_]{2,60}$|^$/, "Environment variable name, e.g. SMTP_URL"),
      notes: z.string().trim().max(500),
      public_config: z.record(z.string(), z.string().max(300)),
    })
    .safeParse({
      status: str(fd, "status"),
      secret_env: str(fd, "secret_env"),
      notes: str(fd, "notes"),
      public_config: Object.fromEntries(
        fd.getAll("config_key").map(String).map((k, i) => [k.trim(), String(fd.getAll("config_value")[i] ?? "").trim()]).filter(([k, v]) => /^[a-z0-9_]{1,40}$/.test(k) && v),
      ),
    });
  if (!parsed.success) return { ...idle, message: parsed.error.issues.map((i) => i.message).join("; ") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("integration_connections").update({ ...parsed.data, secret_env: parsed.data.secret_env || null }).eq("provider", provider);
  if (error) return { ...idle, message: error.code === "22023" ? "Public config may not contain secrets." : friendlyDbError(error) };
  revalidatePath("/admin/marketing/integrations");
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Segments and campaigns
// ---------------------------------------------------------------------------
export async function saveSegment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return { ...idle, message: auth.message };
  const definition: Record<string, unknown> = {};
  if (fd.get("has_ordered") === "on") definition.has_ordered = true;
  if (num(fd, "min_orders")) definition.min_orders = num(fd, "min_orders");
  if (num(fd, "last_order_days")) definition.last_order_days = num(fd, "last_order_days");
  const name = str(fd, "name");
  if (name.length < 2) return { ...idle, message: "Name the segment." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("customer_segments").insert({ name, definition });
  if (error) return { ...idle, message: friendlyDbError(error) };
  revalidatePath("/admin/marketing/campaigns");
  return { ok: true, message: "Segment saved." };
}

export async function saveCampaign(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return { ...idle, message: auth.message };
  const parsed = z
    .object({ name: z.string().trim().min(2).max(120), channel: z.enum(["email", "sms"]), segment_id: UUID, template_key: z.string().regex(/^[a-z0-9_]{3,60}$/), utm: z.record(z.string(), z.string().max(150)) })
    .safeParse({ name: str(fd, "name"), channel: str(fd, "channel"), segment_id: str(fd, "segment_id"), template_key: str(fd, "template_key"), utm: { utm_source: str(fd, "utm_source") || "campaign", utm_medium: str(fd, "channel"), utm_campaign: str(fd, "utm_campaign") || str(fd, "name") } });
  if (!parsed.success) return { ...idle, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("campaigns").insert(parsed.data);
  if (error) return { ...idle, message: friendlyDbError(error) };
  revalidatePath("/admin/marketing/campaigns");
  return { ok: true, message: "Campaign saved as a draft." };
}

export async function sendCampaign(id: string): Promise<void> {
  const auth = await checkStaff("marketing.manage");
  if (!auth.ok) return;
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("admin_campaign_send", { p_campaign_id: id });
  revalidatePath("/admin/marketing/campaigns");
  await runAutomationTick({ events: 50, messages: 50 }).catch(() => undefined);
  revalidatePath("/admin/marketing/outbox");
}
