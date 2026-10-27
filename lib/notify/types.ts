export type SendResult = { ok: true; providerMessageId: string | null } | { ok: false; error: string; retryable: boolean };

export type EmailMessage = { to: string; subject: string; text: string; listUnsubscribe?: string };
export type SmsMessage = { to: string; text: string };
export type WhatsappMessage = { to: string; templateName: string; languageCode: string; variables: string[] };

export type EmailProvider = { name: string; isMock: boolean; send(m: EmailMessage): Promise<SendResult> };
export type SmsProvider = { name: string; isMock: boolean; send(m: SmsMessage): Promise<SendResult> };
export type WhatsappProvider = { name: string; isMock: boolean; send(m: WhatsappMessage): Promise<SendResult> };

export const MOCK_LABEL = "MOCK: nothing was delivered";
