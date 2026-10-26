import "server-only";
import { randomUUID } from "node:crypto";
import { createTransport, type Transporter } from "nodemailer";
import { selectEmailProvider, selectSmsProvider, selectWhatsappProvider } from "./select";
import type { EmailProvider, SendResult, SmsProvider, WhatsappProvider } from "./types";

const env = () => process.env as Record<string, string | undefined>;

function mock<T>(name: string): { name: string; isMock: true; send(m: T): Promise<SendResult> } {
  return {
    name: `mock-${name}`,
    isMock: true,
    async send() {
      // Nothing leaves the server. The outbox keeps the rendered preview for staff.
      return { ok: true, providerMessageId: `mock-${randomUUID()}` };
    },
  };
}

function classify(e: unknown): SendResult {
  const msg = e instanceof Error ? e.message : String(e);
  const retryable = /timeout|ECONN|ETIMEDOUT|EAI_AGAIN|421|450|451|452|4\d\d/.test(msg) && !/5[0-9][0-9]/.test(msg);
  return { ok: false, error: msg.slice(0, 300), retryable };
}

let smtpTransport: Transporter | null = null;

export function getEmailProvider(): EmailProvider | null {
  const kind = selectEmailProvider(env());
  if (kind === "mock") return mock("email");
  if (kind !== "smtp") return null;
  const from = env().SMTP_FROM ?? "no-reply@localhost";
  return {
    name: "smtp",
    isMock: false,
    async send(m) {
      try {
        smtpTransport ??= createTransport(env().SMTP_URL!);
        const info = await smtpTransport.sendMail({
          from,
          to: m.to,
          subject: m.subject.replace(/[\r\n]/g, " ").slice(0, 200),
          text: m.text,
          headers: m.listUnsubscribe ? { "List-Unsubscribe": `<${m.listUnsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
        });
        return { ok: true, providerMessageId: info.messageId ?? null };
      } catch (e) {
        return classify(e);
      }
    },
  };
}

/**
 * Generic HTTP SMS gateway stub: POST JSON {to, text} with a bearer key. Most
 * Bangladesh gateways (SSL Wireless, Banglalink, etc.) need their own adapter;
 * this is the shape to adapt and is NOT verified against any real gateway.
 */
export function getSmsProvider(): SmsProvider | null {
  const kind = selectSmsProvider(env());
  if (kind === "mock") return mock("sms");
  if (kind !== "http_gateway") return null;
  return {
    name: "http_gateway",
    isMock: false,
    async send(m) {
      try {
        const res = await fetch(env().SMS_GATEWAY_URL!, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env().SMS_API_KEY}` },
          body: JSON.stringify({ to: m.to, text: m.text.slice(0, 480), sender: env().SMS_SENDER_ID ?? undefined }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { ok: false, error: `gateway ${res.status}`, retryable: res.status >= 500 || res.status === 429 };
        const body = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string };
        return { ok: true, providerMessageId: body.id ?? body.message_id ?? null };
      } catch (e) {
        return classify(e);
      }
    },
  };
}

/** WhatsApp Business (Meta Cloud API) template message. Unverified against a live account. */
export function getWhatsappProvider(): WhatsappProvider | null {
  const kind = selectWhatsappProvider(env());
  if (kind === "mock") return mock("whatsapp");
  if (kind !== "meta_cloud") return null;
  return {
    name: "meta_cloud",
    isMock: false,
    async send(m) {
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${env().WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env().WHATSAPP_ACCESS_TOKEN}` },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: m.to.replace(/^\+/, ""),
            type: "template",
            template: {
              name: m.templateName,
              language: { code: m.languageCode },
              components: m.variables.length ? [{ type: "body", parameters: m.variables.map((text) => ({ type: "text", text })) }] : [],
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { ok: false, error: `whatsapp ${res.status}`, retryable: res.status >= 500 || res.status === 429 };
        const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[] };
        return { ok: true, providerMessageId: body.messages?.[0]?.id ?? null };
      } catch (e) {
        return classify(e);
      }
    },
  };
}

export function notifyOffer() {
  const e = env();
  return {
    email: selectEmailProvider(e),
    sms: selectSmsProvider(e),
    whatsapp: selectWhatsappProvider(e),
  };
}
