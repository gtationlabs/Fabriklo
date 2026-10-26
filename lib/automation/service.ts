import "server-only";
import { createHmac } from "node:crypto";
import { publicEnv } from "@/lib/env";
import { getEmailProvider, getSmsProvider, getWhatsappProvider } from "@/lib/notify/providers";
import { renderTemplate, templateVars } from "@/lib/notify/templates";
import { checkWebhookTarget, sendWebhook } from "@/lib/notify/webhook";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The automation worker. Service role, never reachable from the browser:
 *   1. marketing_events → automation_process_events (rules decide, outbox rows are written),
 *   2. notification_outbox → claim → render template → provider → sent / retry / dead.
 * Single-flight per server instance; safe to run from several instances because
 * claims use FOR UPDATE SKIP LOCKED.
 */
export type TickResult = { events: number; claimed: number; sent: number; failed: number; dead: number };

type OutboxRow = {
  id: string;
  channel: "email" | "sms" | "whatsapp" | "webhook" | "internal";
  message_class: "transactional" | "marketing" | "internal";
  recipient: string | null;
  user_id: string | null;
  template_key: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  event_id: number | null;
};

export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "Fabriklo";

let inFlight: Promise<TickResult> | null = null;

export function runAutomationTick(opts: { events?: number; messages?: number } = {}): Promise<TickResult> {
  if (inFlight) return inFlight;
  inFlight = tick(opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Stable per-address unsubscribe token: HMAC over the lower-cased email with a server secret. */
export function unsubscribeToken(email: string): string {
  const secret = process.env.NOTIFY_TOKEN_SECRET || process.env.SUPABASE_SECRET_KEY || "";
  return createHmac("sha256", `unsubscribe:${secret}`).update(email.trim().toLowerCase()).digest("hex").slice(0, 48);
}

async function tick(opts: { events?: number; messages?: number }): Promise<TickResult> {
  const svc = createSupabaseServiceClient();
  const result: TickResult = { events: 0, claimed: 0, sent: 0, failed: 0, dead: 0 };
  const batch = Math.min(Math.max(opts.events ?? 200, 1), 500);
  for (let i = 0; i < 5; i++) {
    const { data, error } = await svc.rpc("automation_process_events", { p_limit: batch });
    if (error) throw new Error(`automation_process_events: ${error.message}`);
    const n = Number(data ?? 0);
    result.events += n;
    if (n < batch) break;
  }

  const { data: claimed, error: claimError } = await svc.rpc("outbox_claim", { p_limit: Math.min(Math.max(opts.messages ?? 20, 1), 100) });
  if (claimError) throw new Error(`outbox_claim: ${claimError.message}`);
  const rows = (claimed ?? []) as OutboxRow[];
  result.claimed = rows.length;
  if (!rows.length) return result;

  const { data: allow } = await svc.from("site_settings").select("value").eq("key", "automation.webhook_allowlist").maybeSingle();
  const allowlist = ((allow?.value as { hosts?: unknown } | null)?.hosts as string[] | undefined)?.filter((h) => typeof h === "string") ?? [];

  for (const row of rows) {
    const outcome = await dispatch(svc, row, allowlist).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), retryable: true, provider: null as string | null }));
    if (outcome.ok) {
      await svc.rpc("outbox_mark_sent", { p_id: row.id, p_provider: outcome.provider, p_provider_message_id: outcome.providerMessageId, p_preview: outcome.preview ?? null });
      result.sent += 1;
    } else {
      const { data: status } = await svc.rpc("outbox_mark_failed", { p_id: row.id, p_error: outcome.error, p_retryable: outcome.retryable, p_provider: outcome.provider ?? null });
      if (status === "dead") result.dead += 1;
      else result.failed += 1;
    }
  }
  return result;
}

type Dispatch =
  | { ok: true; provider: string; providerMessageId: string | null; preview?: string }
  | { ok: false; error: string; retryable: boolean; provider: string | null };

async function dispatch(svc: ReturnType<typeof createSupabaseServiceClient>, row: OutboxRow, allowlist: string[]): Promise<Dispatch> {
  const siteUrl = publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const payload = row.payload ?? {};

  if (row.channel === "email") {
    const provider = getEmailProvider();
    if (!provider) return { ok: false, error: "email provider not configured (SMTP_URL)", retryable: false, provider: null };
    if (!row.recipient || !row.template_key) return { ok: false, error: "missing recipient or template", retryable: false, provider: provider.name };
    const { data: tpl } = await svc.from("email_templates").select("subject, body_text").eq("key", row.template_key).maybeSingle();
    if (!tpl) return { ok: false, error: `email template ${row.template_key} not found`, retryable: false, provider: provider.name };
    let unsubscribeUrl: string | undefined;
    if (row.message_class === "marketing") {
      const token = unsubscribeToken(row.recipient);
      const { error } = await svc.rpc("newsletter_unsubscribe_token_set", { p_email: row.recipient, p_token: token });
      if (error) return { ok: false, error: `unsubscribe token: ${error.message}`, retryable: true, provider: provider.name };
      unsubscribeUrl = `${siteUrl}/newsletter/unsubscribe?token=${token}`;
    }
    const confirmToken = typeof payload.confirm_token === "string" ? payload.confirm_token : undefined;
    const vars = templateVars(payload, { siteUrl, storeName: STORE_NAME, unsubscribeUrl, confirmUrl: confirmToken ? `${siteUrl}/newsletter/confirm?token=${confirmToken}` : undefined });
    const subject = renderTemplate(tpl.subject, vars);
    let text = renderTemplate(tpl.body_text, vars);
    if (unsubscribeUrl && !text.includes(unsubscribeUrl)) text += `\n\nUnsubscribe: ${unsubscribeUrl}`;
    const r = await provider.send({ to: row.recipient, subject, text, listUnsubscribe: unsubscribeUrl });
    return r.ok ? { ok: true, provider: provider.name, providerMessageId: r.providerMessageId, preview: `Subject: ${subject}\n\n${text}` } : { ...r, provider: provider.name };
  }

  if (row.channel === "sms") {
    const provider = getSmsProvider();
    if (!provider) return { ok: false, error: "sms provider not configured", retryable: false, provider: null };
    if (!row.recipient || !row.template_key) return { ok: false, error: "missing recipient or template", retryable: false, provider: provider.name };
    const { data: tpl } = await svc.from("sms_templates").select("body_text").eq("key", row.template_key).maybeSingle();
    if (!tpl) return { ok: false, error: `sms template ${row.template_key} not found`, retryable: false, provider: provider.name };
    const text = renderTemplate(tpl.body_text, templateVars(payload, { siteUrl, storeName: STORE_NAME }));
    const r = await provider.send({ to: row.recipient, text });
    return r.ok ? { ok: true, provider: provider.name, providerMessageId: r.providerMessageId, preview: text } : { ...r, provider: provider.name };
  }

  if (row.channel === "whatsapp") {
    const provider = getWhatsappProvider();
    if (!provider) return { ok: false, error: "whatsapp provider not configured", retryable: false, provider: null };
    if (!row.recipient || !row.template_key) return { ok: false, error: "missing recipient or template", retryable: false, provider: provider.name };
    const { data: tpl } = await svc.from("whatsapp_templates").select("provider_template_name, language_code, variables").eq("key", row.template_key).maybeSingle();
    if (!tpl) return { ok: false, error: `whatsapp template ${row.template_key} not found`, retryable: false, provider: provider.name };
    const vars = templateVars(payload, { siteUrl, storeName: STORE_NAME });
    const variables = ((tpl.variables as string[]) ?? []).map((v) => String(vars[v] ?? ""));
    const r = await provider.send({ to: row.recipient, templateName: tpl.provider_template_name, languageCode: tpl.language_code, variables });
    return r.ok
      ? { ok: true, provider: provider.name, providerMessageId: r.providerMessageId, preview: `${tpl.provider_template_name}(${variables.join(", ")})` }
      : { ...r, provider: provider.name };
  }

  if (row.channel === "webhook") {
    const target = checkWebhookTarget(row.recipient ?? "", allowlist);
    const host = (() => {
      try {
        return new URL(row.recipient ?? "").hostname;
      } catch {
        return "invalid";
      }
    })();
    if (!target.ok) {
      await svc.rpc("outbox_log_webhook", { p_outbox_id: row.id, p_url_host: host, p_attempt: row.attempts, p_status_code: null, p_ok: false, p_excerpt: `refused: ${target.reason}` });
      return { ok: false, error: `webhook target refused: ${target.reason}`, retryable: false, provider: "webhook" };
    }
    const { rule_name, title, note, severity, event_name, ...data } = payload as Record<string, unknown>;
    const r = await sendWebhook(target.url, { ...data, title, note, severity, rule_name }, {
      secret: process.env.WEBHOOK_SIGNING_SECRET ?? null,
      eventName: typeof event_name === "string" ? event_name : "event",
      deliveryId: row.id,
    });
    await svc.rpc("outbox_log_webhook", { p_outbox_id: row.id, p_url_host: target.url.hostname, p_attempt: row.attempts, p_status_code: r.status, p_ok: r.ok, p_excerpt: r.excerpt });
    return r.ok
      ? { ok: true, provider: "webhook", providerMessageId: r.status ? String(r.status) : null, preview: `POST ${target.url.hostname} → ${r.status}` }
      : { ok: false, error: `webhook ${r.status ?? "network"}: ${r.excerpt}`, retryable: r.retryable, provider: "webhook" };
  }

  return { ok: false, error: `channel ${row.channel} is not dispatched by the worker`, retryable: false, provider: null };
}
