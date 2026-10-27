/**
 * Pure provider selection (unit-tested). A mock provider is used only outside
 * production, or when NOTIFY_ALLOW_MOCK=true (the Playwright server sets it).
 * In production without configuration the channel has NO provider: messages
 * are dead-lettered with a clear error instead of being silently "sent".
 */
export type NotifyEnv = Partial<Record<"NODE_ENV" | "NOTIFY_ALLOW_MOCK" | "SMTP_URL" | "SMS_GATEWAY_URL" | "SMS_API_KEY" | "WHATSAPP_ACCESS_TOKEN" | "WHATSAPP_PHONE_NUMBER_ID", string>>;

function mockAllowed(env: NotifyEnv) {
  return env.NOTIFY_ALLOW_MOCK === "true" || env.NODE_ENV !== "production";
}

export function selectEmailProvider(env: NotifyEnv): "smtp" | "mock" | null {
  if (env.SMTP_URL) return "smtp";
  return mockAllowed(env) ? "mock" : null;
}

export function selectSmsProvider(env: NotifyEnv): "http_gateway" | "mock" | null {
  if (env.SMS_GATEWAY_URL && env.SMS_API_KEY) return "http_gateway";
  return mockAllowed(env) ? "mock" : null;
}

export function selectWhatsappProvider(env: NotifyEnv): "meta_cloud" | "mock" | null {
  if (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) return "meta_cloud";
  return mockAllowed(env) ? "mock" : null;
}
