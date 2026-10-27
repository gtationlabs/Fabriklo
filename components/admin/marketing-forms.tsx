"use client";

import { useActionState, useState } from "react";
import {
  addSuppression,
  saveBanner,
  saveCampaign,
  saveIntegration,
  savePromotion,
  saveRule,
  saveSegment,
  saveTemplate,
  saveWebhookAllowlist,
  testRule,
  type ActionState,
  type TestResult,
} from "@/app/admin/(console)/marketing/actions";
import { ACTION_TYPES, CONDITION_FIELDS, CONDITION_OPS, TRIGGERS, TRIGGER_LABELS } from "@/lib/marketing/constants";
import { FormMessage, inputCls } from "./form-bits";

const idle: ActionState = { ok: false, message: null };
const btn = "rounded bg-espresso px-4 py-2 text-sm text-cream disabled:opacity-60";
const lbl = "block text-sm";
const span = "font-medium text-espresso";
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------
export type PromotionRow = {
  id: string;
  kind: "coupon" | "automatic";
  code: string | null;
  name: string;
  description: string | null;
  discount_type: "percent" | "fixed" | "free_shipping";
  discount_value: number;
  max_discount_minor: number | null;
  scope: "order" | "categories" | "collections" | "variants";
  target_ids: string[];
  min_subtotal_minor: number;
  first_order_only: boolean;
  once_per_customer: boolean;
  max_redemptions: number | null;
  redemption_count: number;
  priority: number;
  stackable: boolean;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};
export type TargetOptions = { categories: { id: string; name: string }[]; collections: { id: string; name: string }[]; variants: { id: string; label: string }[] };

export function PromotionForm({ promotion, targets }: { promotion: PromotionRow | null; targets: TargetOptions }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePromotion.bind(null, promotion?.id ?? null), idle);
  const [kind, setKind] = useState<"coupon" | "automatic">(promotion?.kind ?? "coupon");
  const [discountType, setDiscountType] = useState(promotion?.discount_type ?? "percent");
  const [scope, setScope] = useState(promotion?.scope ?? "order");
  const options = scope === "categories" ? targets.categories.map((c) => ({ id: c.id, label: c.name })) : scope === "collections" ? targets.collections.map((c) => ({ id: c.id, label: c.name })) : scope === "variants" ? targets.variants : [];
  return (
    <form action={action} aria-label={promotion ? "Edit promotion" : "New promotion"} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={lbl}>
          <span className={span}>Type</span>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "coupon" | "automatic")} className={inputCls}>
            <option value="coupon">Coupon code (customer enters it)</option>
            <option value="automatic">Automatic discount (applies by itself)</option>
          </select>
        </label>
        {kind === "coupon" ? (
          <label className={lbl}>
            <span className={span}>Code</span>
            <input name="code" defaultValue={promotion?.code ?? ""} required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}" className={`${inputCls} uppercase`} />
            <span className="text-xs text-muted">3–32 letters/digits. Customers can type it in any case.</span>
          </label>
        ) : null}
        <label className={lbl}>
          <span className={span}>Name</span>
          <input name="name" defaultValue={promotion?.name ?? ""} required maxLength={120} className={inputCls} />
        </label>
        <label className={lbl}>
          <span className={span}>Description (internal)</span>
          <input name="description" defaultValue={promotion?.description ?? ""} maxLength={500} className={inputCls} />
        </label>
        <label className={lbl}>
          <span className={span}>Discount</span>
          <select name="discount_type" value={discountType} onChange={(e) => setDiscountType(e.target.value as PromotionRow["discount_type"])} className={inputCls}>
            <option value="percent">Percentage off</option>
            <option value="fixed">Fixed amount off (৳)</option>
            <option value="free_shipping">Free delivery</option>
          </select>
        </label>
        {discountType !== "free_shipping" ? (
          <label className={lbl}>
            <span className={span}>{discountType === "percent" ? "Percent (1–100)" : "Amount in taka"}</span>
            <input name="discount_value" type="number" min={discountType === "percent" ? 1 : 1} max={discountType === "percent" ? 100 : undefined} step={discountType === "percent" ? 1 : 1} defaultValue={promotion ? (promotion.discount_type === "fixed" ? promotion.discount_value / 100 : promotion.discount_value) : discountType === "percent" ? 10 : 100} required className={inputCls} />
          </label>
        ) : null}
        {discountType === "percent" ? (
          <label className={lbl}>
            <span className={span}>Cap the discount at (৳, optional)</span>
            <input name="max_discount" type="number" min={1} defaultValue={promotion?.max_discount_minor ? promotion.max_discount_minor / 100 : ""} className={inputCls} />
          </label>
        ) : null}
        <label className={lbl}>
          <span className={span}>Applies to</span>
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value as PromotionRow["scope"])} className={inputCls}>
            <option value="order">Whole order</option>
            <option value="categories">Selected categories</option>
            <option value="collections">Selected collections</option>
            <option value="variants">Selected variants (SKUs)</option>
          </select>
        </label>
        {scope !== "order" ? (
          <label className={lbl}>
            <span className={span}>Targets (hold Ctrl/⌘ to pick several)</span>
            <select name="target_ids" multiple size={6} defaultValue={promotion?.scope === scope ? promotion.target_ids : []} className={inputCls}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={lbl}>
          <span className={span}>Minimum basket (৳, before discount)</span>
          <input name="min_subtotal" type="number" min={0} defaultValue={(promotion?.min_subtotal_minor ?? 0) / 100} className={inputCls} />
        </label>
        <label className={lbl}>
          <span className={span}>Redemption limit (blank = unlimited)</span>
          <input name="max_redemptions" type="number" min={1} defaultValue={promotion?.max_redemptions ?? ""} className={inputCls} />
          {promotion ? <span className="text-xs text-muted">Redeemed {promotion.redemption_count} times so far.</span> : null}
        </label>
        <label className={lbl}>
          <span className={span}>Starts</span>
          <input name="starts_at" type="datetime-local" defaultValue={toLocalInput(promotion?.starts_at ?? null)} className={inputCls} />
        </label>
        <label className={lbl}>
          <span className={span}>Ends</span>
          <input name="ends_at" type="datetime-local" defaultValue={toLocalInput(promotion?.ends_at ?? null)} className={inputCls} />
        </label>
        <label className={lbl}>
          <span className={span}>Priority (lower runs first)</span>
          <input name="priority" type="number" defaultValue={promotion?.priority ?? 100} className={inputCls} />
          <span className="text-xs text-muted">A coupon is always considered before automatic discounts.</span>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="first_order_only" defaultChecked={promotion?.first_order_only ?? false} /> First order only (checked by account, phone and email)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="once_per_customer" defaultChecked={promotion?.once_per_customer ?? false} /> One use per customer</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="stackable" defaultChecked={promotion?.stackable ?? false} /> Stackable with other stackable promotions</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={promotion?.is_active ?? true} /> Active</label>
      </div>
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={btn}>{promotion ? "Save changes" : "Create promotion"}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Newsletter suppression
// ---------------------------------------------------------------------------
export function SuppressionForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addSuppression, idle);
  return (
    <form action={action} aria-label="Add to suppression list" className="flex flex-wrap items-end gap-2 text-sm">
      <label className={lbl}><span className={span}>Email or phone</span><input name="identifier" required className={inputCls} placeholder="name@example.com or +8801…" /></label>
      <label className={lbl}><span className={span}>Channel</span>
        <select name="channel" defaultValue="all" className={inputCls}><option value="all">All</option><option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select>
      </label>
      <label className={lbl}><span className={span}>Reason</span><input name="reason" maxLength={200} className={inputCls} /></label>
      <button type="submit" disabled={pending} className={btn}>Suppress</button>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export type TemplateRow = { key: string; name: string; message_class: "transactional" | "marketing"; subject?: string; body_text?: string; provider_template_name?: string; language_code?: string; variables?: string[] };

export function TemplateForm({ kind, template }: { kind: "email" | "sms" | "whatsapp"; template: TemplateRow | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTemplate.bind(null, kind, template?.key ?? null), idle);
  return (
    <form action={action} aria-label={template ? `Edit ${template.key}` : `New ${kind} template`} className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={lbl}><span className={span}>Key</span><input name="key" defaultValue={template?.key ?? ""} readOnly={Boolean(template)} required pattern="[a-z0-9_]{3,60}" className={`${inputCls} ${template ? "bg-sand" : ""}`} /></label>
        <label className={lbl}><span className={span}>Name</span><input name="name" defaultValue={template?.name ?? ""} required className={inputCls} /></label>
        <label className={lbl}><span className={span}>Class</span>
          <select name="message_class" defaultValue={template?.message_class ?? "transactional"} className={inputCls}>
            <option value="transactional">Transactional (sent regardless of opt-in)</option>
            <option value="marketing">Marketing (needs opt-in, carries unsubscribe link)</option>
          </select>
        </label>
      </div>
      {kind === "email" ? (
        <>
          <label className={lbl}><span className={span}>Subject</span><input name="subject" defaultValue={template?.subject ?? ""} required maxLength={200} className={inputCls} /></label>
          <label className={lbl}><span className={span}>Body (plain text)</span><textarea name="body_text" defaultValue={template?.body_text ?? ""} required rows={8} className={`${inputCls} font-mono text-xs`} /></label>
        </>
      ) : kind === "sms" ? (
        <label className={lbl}><span className={span}>Text (max 480 characters)</span><textarea name="body_text" defaultValue={template?.body_text ?? ""} required rows={3} maxLength={480} className={`${inputCls} font-mono text-xs`} /></label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={lbl}><span className={span}>Provider template name</span><input name="provider_template_name" defaultValue={template?.provider_template_name ?? ""} required className={inputCls} /></label>
          <label className={lbl}><span className={span}>Language</span><input name="language_code" defaultValue={template?.language_code ?? "en"} className={inputCls} /></label>
          <label className={lbl}><span className={span}>Variables (comma separated placeholder names)</span><input name="variables" defaultValue={(template?.variables ?? []).join(", ")} className={inputCls} /></label>
        </div>
      )}
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={btn}>{template ? "Save template" : "Create template"}</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Automation rules
// ---------------------------------------------------------------------------
export type RuleRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  conditions: { field: string; op: string; value?: unknown }[];
  action: Record<string, unknown>;
  is_active: boolean;
  mode: "dry_run" | "live";
  quota_per_hour: number;
  version: number;
};
export type TemplateKeys = { email: string[]; sms: string[]; whatsapp: string[] };

export function RuleForm({ rule, templates, allowlist }: { rule: RuleRow | null; templates: TemplateKeys; allowlist: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveRule.bind(null, rule?.id ?? null), idle);
  const [actionType, setActionType] = useState<string>((rule?.action.type as string) ?? "internal_alert");
  const [to, setTo] = useState<string>((rule?.action.to as string) ?? "customer");
  const [conditions, setConditions] = useState(rule?.conditions.length ? rule.conditions : []);
  const a = rule?.action ?? {};
  const templateList = actionType === "email" ? templates.email : actionType === "sms" ? templates.sms : templates.whatsapp;
  return (
    <form action={action} aria-label={rule ? "Edit rule" : "New rule"} className="space-y-5 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={lbl}><span className={span}>Name</span><input name="name" defaultValue={rule?.name ?? ""} required maxLength={120} className={inputCls} /></label>
        <label className={lbl}><span className={span}>Description</span><input name="description" defaultValue={rule?.description ?? ""} maxLength={500} className={inputCls} /></label>
        <label className={lbl}><span className={span}>Trigger</span>
          <select name="trigger_type" defaultValue={rule?.trigger_type ?? "order.placed"} className={inputCls}>
            {TRIGGERS.map((t) => (<option key={t} value={t}>{TRIGGER_LABELS[t]} ({t})</option>))}
          </select>
        </label>
        <label className={lbl}><span className={span}>Mode</span>
          <select name="mode" defaultValue={rule?.mode ?? "dry_run"} className={inputCls}>
            <option value="dry_run">Dry run (records what would happen, sends nothing)</option>
            <option value="live">Live</option>
          </select>
        </label>
        <label className={lbl}><span className={span}>Quota per hour</span><input name="quota_per_hour" type="number" min={1} max={10000} defaultValue={rule?.quota_per_hour ?? 100} className={inputCls} /></label>
        <label className="flex items-center gap-2 self-end"><input type="checkbox" name="is_active" defaultChecked={rule?.is_active ?? false} /> Active</label>
      </div>

      <fieldset className="space-y-2 rounded border border-line p-3">
        <legend className="px-1 font-medium text-espresso">Conditions (all must match)</legend>
        {conditions.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
            <input name="cond_field" list="cond-fields" defaultValue={c.field} placeholder="field" pattern="[a-z0-9_.]{1,60}" className={inputCls} />
            <select name="cond_op" defaultValue={c.op} className={inputCls}>{CONDITION_OPS.map((o) => (<option key={o} value={o}>{o}</option>))}</select>
            <input name="cond_value" defaultValue={c.value === undefined ? "" : Array.isArray(c.value) ? c.value.join(",") : String(c.value)} placeholder="value (numbers compare numerically; lists comma-separated)" className={inputCls} />
            <button type="button" onClick={() => setConditions(conditions.filter((_, j) => j !== i))} className="rounded border border-line px-2 text-xs">Remove</button>
          </div>
        ))}
        <datalist id="cond-fields">{CONDITION_FIELDS.map((f) => (<option key={f} value={f} />))}</datalist>
        <button type="button" onClick={() => setConditions([...conditions, { field: "", op: "eq", value: "" }])} disabled={conditions.length >= 20} className="rounded border border-espresso px-3 py-1 text-xs">Add condition</button>
      </fieldset>

      <fieldset className="space-y-3 rounded border border-line p-3">
        <legend className="px-1 font-medium text-espresso">Action</legend>
        <label className={lbl}><span className={span}>Type</span>
          <select name="action_type" value={actionType} onChange={(e) => setActionType(e.target.value)} className={inputCls}>
            {ACTION_TYPES.map((t) => (<option key={t} value={t}>{t.replace("_", " ")}</option>))}
          </select>
        </label>
        {actionType === "email" || actionType === "sms" || actionType === "whatsapp" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={lbl}><span className={span}>Template</span>
              <select name="template_key" defaultValue={(a.template_key as string) ?? templateList[0] ?? ""} className={inputCls}>{templateList.map((k) => (<option key={k} value={k}>{k}</option>))}</select>
            </label>
            <label className={lbl}><span className={span}>Message class</span>
              <select name="message_class" defaultValue={(a.message_class as string) ?? "transactional"} className={inputCls}><option value="transactional">Transactional</option><option value="marketing">Marketing (consent required)</option></select>
            </label>
            {actionType === "email" ? (
              <label className={lbl}><span className={span}>Send to</span>
                <select name="to" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls}><option value="customer">The customer on the event</option><option value="staff">A staff address</option></select>
              </label>
            ) : null}
            {actionType === "email" && to === "staff" ? (
              <label className={lbl}><span className={span}>Staff email</span><input name="staff_email" type="email" defaultValue={(a.staff_email as string) ?? ""} required className={inputCls} /></label>
            ) : null}
          </div>
        ) : actionType === "webhook" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={lbl}><span className={span}>URL (https, host must be allowlisted)</span><input name="url" type="url" defaultValue={(a.url as string) ?? ""} required className={inputCls} />
              <span className="text-xs text-muted">Allowed hosts: {allowlist.length ? allowlist.join(", ") : "none yet (Integrations → Webhook allowlist)"}</span>
            </label>
            <label className={lbl}><span className={span}>Event name (optional)</span><input name="event_name" defaultValue={(a.event_name as string) ?? ""} maxLength={60} className={inputCls} /></label>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={lbl}><span className={span}>Title</span><input name="title" defaultValue={(a.title as string) ?? ""} required minLength={2} maxLength={160} className={inputCls} /></label>
            <label className={lbl}><span className={span}>Note</span><input name="note" defaultValue={(a.note as string) ?? ""} maxLength={500} className={inputCls} /></label>
            <label className={lbl}><span className={span}>Severity</span>
              <select name="severity" defaultValue={(a.severity as string) ?? "info"} className={inputCls}><option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option></select>
            </label>
          </div>
        )}
      </fieldset>
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={btn}>{rule ? "Save rule" : "Create rule"}</button>
    </form>
  );
}

export function RuleTester({ ruleId }: { ruleId: string }) {
  const [state, action, pending] = useActionState<TestResult, FormData>(testRule.bind(null, ruleId), { ok: false, message: null, rows: [] });
  return (
    <form action={action} className="space-y-2 text-sm" aria-label="Test rule">
      <button type="submit" disabled={pending} className="rounded border border-espresso px-3 py-1.5 text-sm">Test against recent events (sends nothing)</button>
      {state.message ? <p role="status" className={state.ok ? "text-muted" : "text-danger"}>{state.message}</p> : null}
      {state.rows.length ? (
        <table className="w-full text-xs" data-testid="rule-test-results">
          <thead><tr className="text-left text-muted"><th>Event</th><th>When</th><th>Matches</th><th>Recipient</th><th>Marketing allowed</th></tr></thead>
          <tbody>
            {state.rows.map((r) => (
              <tr key={r.event_id} className="border-t border-line">
                <td>#{r.event_id}</td>
                <td>{new Date(r.occurred_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}</td>
                <td>{r.matches ? "yes" : "no"}</td>
                <td>{r.recipient ?? "—"}</td>
                <td>{r.marketing_allowed === null ? "n/a" : r.marketing_allowed ? "yes" : "no (would be suppressed)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Settings: banner, webhook allowlist, integrations
// ---------------------------------------------------------------------------
export function BannerForm({ banner }: { banner: { enabled?: boolean; text?: string; href?: string; starts_at?: string | null; ends_at?: string | null } }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBanner, idle);
  return (
    <form action={action} aria-label="Announcement banner" className="space-y-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={banner.enabled ?? false} /> Show the banner on the store</label>
      <label className={lbl}><span className={span}>Text (max 200)</span><input name="text" defaultValue={banner.text ?? ""} maxLength={200} className={inputCls} /></label>
      <label className={lbl}><span className={span}>Link (site path, optional)</span><input name="href" defaultValue={banner.href ?? ""} placeholder="/collections/new-arrivals" className={inputCls} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={lbl}><span className={span}>From</span><input name="starts_at" type="datetime-local" defaultValue={toLocalInput(banner.starts_at ?? null)} className={inputCls} /></label>
        <label className={lbl}><span className={span}>Until</span><input name="ends_at" type="datetime-local" defaultValue={toLocalInput(banner.ends_at ?? null)} className={inputCls} /></label>
      </div>
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={btn}>Save banner</button>
    </form>
  );
}

export function AllowlistForm({ hosts }: { hosts: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveWebhookAllowlist, idle);
  return (
    <form action={action} aria-label="Webhook allowlist" className="space-y-2 text-sm">
      <label className={lbl}><span className={span}>Allowed webhook hosts (one per line)</span>
        <textarea name="hosts" defaultValue={hosts.join("\n")} rows={4} className={`${inputCls} font-mono text-xs`} placeholder="hooks.example.com" />
      </label>
      <p className="text-xs text-muted">Only https URLs on these exact hosts can receive webhooks. IP addresses and internal names are always refused.</p>
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={btn}>Save allowlist</button>
    </form>
  );
}

export type IntegrationRow = { provider: string; status: string; public_config: Record<string, string>; secret_env: string | null; notes: string | null; secret_present: boolean; updated_at: string };

export function IntegrationForm({ row, canManage }: { row: IntegrationRow; canManage: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveIntegration.bind(null, row.provider), idle);
  const entries = Object.entries(row.public_config);
  const rows = [...entries, ["", ""]].slice(0, 6);
  return (
    <form action={action} aria-label={`${row.provider} settings`} className="space-y-2 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={lbl}><span className={span}>Status</span>
          <select name="status" defaultValue={row.status} disabled={!canManage} className={inputCls}><option value="not_configured">Not configured</option><option value="configured">Configured</option><option value="disabled">Disabled</option></select>
        </label>
        <label className={lbl}><span className={span}>Secret env var name</span><input name="secret_env" defaultValue={row.secret_env ?? ""} readOnly={!canManage} pattern="[A-Z][A-Z0-9_]{2,60}" className={inputCls} />
          <span className={`text-xs ${row.secret_present ? "text-success" : "text-muted"}`}>{row.secret_env ? (row.secret_present ? "Present in the server environment" : "Not set in the server environment") : "No secret"}</span>
        </label>
        <label className={lbl}><span className={span}>Notes</span><input name="notes" defaultValue={row.notes ?? ""} readOnly={!canManage} maxLength={500} className={inputCls} /></label>
      </div>
      <div className="space-y-1">
        <span className={span}>Public settings (ids only, never secrets)</span>
        {rows.map(([k, v], i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-2">
            <input name="config_key" defaultValue={k} placeholder="key (e.g. pixel_id)" readOnly={!canManage} pattern="[a-z0-9_]{1,40}" className={inputCls} />
            <input name="config_value" defaultValue={v} placeholder="value" readOnly={!canManage} maxLength={300} className={inputCls} />
          </div>
        ))}
      </div>
      <FormMessage state={state} />
      {canManage ? <button type="submit" disabled={pending} className={btn}>Save</button> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Segments and campaigns
// ---------------------------------------------------------------------------
export function SegmentForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSegment, idle);
  return (
    <form action={action} aria-label="New segment" className="space-y-2 text-sm">
      <label className={lbl}><span className={span}>Name</span><input name="name" required className={inputCls} /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex items-center gap-2 self-end"><input type="checkbox" name="has_ordered" /> Has ordered before</label>
        <label className={lbl}><span className={span}>Minimum orders</span><input name="min_orders" type="number" min={0} className={inputCls} /></label>
        <label className={lbl}><span className={span}>Ordered in the last (days)</span><input name="last_order_days" type="number" min={1} className={inputCls} /></label>
      </div>
      <p className="text-xs text-muted">Members are always limited to people who opted in to marketing and are not on the suppression list.</p>
      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={btn}>Save segment</button>
    </form>
  );
}

export function CampaignForm({ segments, templates }: { segments: { id: string; name: string }[]; templates: { email: string[]; sms: string[] } }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCampaign, idle);
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const keys = channel === "email" ? templates.email : templates.sms;
  return (
    <form action={action} aria-label="New campaign" className="space-y-2 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={lbl}><span className={span}>Name</span><input name="name" required className={inputCls} /></label>
        <label className={lbl}><span className={span}>Channel</span>
          <select name="channel" value={channel} onChange={(e) => setChannel(e.target.value as "email" | "sms")} className={inputCls}><option value="email">Email</option><option value="sms">SMS</option></select>
        </label>
        <label className={lbl}><span className={span}>Segment</span>
          <select name="segment_id" required className={inputCls}>{segments.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select>
        </label>
        <label className={lbl}><span className={span}>Template (marketing class)</span>
          <select name="template_key" required className={inputCls}>{keys.map((k) => (<option key={k} value={k}>{k}</option>))}</select>
        </label>
        <label className={lbl}><span className={span}>UTM source</span><input name="utm_source" defaultValue="newsletter" maxLength={100} className={inputCls} /></label>
        <label className={lbl}><span className={span}>UTM campaign</span><input name="utm_campaign" maxLength={150} className={inputCls} /></label>
      </div>
      <FormMessage state={state} />
      <button type="submit" disabled={pending || !segments.length} className={btn}>Save draft</button>
    </form>
  );
}
