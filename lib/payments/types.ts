/**
 * Provider-agnostic payment contract. The database (`payment_settle`) is the
 * only thing that can mark an order paid, and it does so only after the server
 * has validated the transaction with the provider through this interface.
 */
export type PaymentProviderId = "sslcommerz" | "mock";

export type SessionRequest = {
  tranId: string;
  orderNumber: string;
  amountMinor: number;
  currency: "BDT";
  customer: {
    name: string;
    phone: string;
    email: string | null;
    address: { address_line: string; area: string; district: string; postal_code: string | null };
  };
  itemCount: number;
  urls: { success: string; fail: string; cancel: string; ipn: string };
};

export type SessionResult =
  | { ok: true; redirectUrl: string; sessionKey: string }
  | { ok: false; reason: string };

export type ValidationOutcome = "valid" | "failed" | "cancelled" | "unknown";

export type ValidationResult = {
  outcome: ValidationOutcome;
  tranId: string | null;
  amountMinor: number | null;
  currency: string | null;
  valId: string | null;
  bankTranId: string | null;
  cardType: string | null;
  /** Provider's own risk flag as a short string ("1" = high for SSLCOMMERZ). */
  riskLevel: string | null;
  raw: Record<string, unknown>;
};

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  /** Shown to customers and staff. Must never suggest a mock is a real gateway. */
  readonly label: string;
  /** True only for a real gateway in live (non-sandbox) mode. */
  readonly isLive: boolean;
  readonly isMock: boolean;
  createSession(req: SessionRequest): Promise<SessionResult>;
  /** Asks the provider (server to server) whether `valId` is a genuine, completed payment. */
  validate(valId: string): Promise<ValidationResult>;
  /** Checks the provider's message signature when it has one. */
  verifyIpnSignature(form: Record<string, string>): boolean;
}

/** "1234.50" → 123450. Rejects anything that is not a plain decimal amount. */
export function decimalToMinor(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** 123450 → "1234.50" (gateways take decimal strings). */
export function minorToDecimal(minor: number): string {
  if (!Number.isInteger(minor) || minor < 0) throw new Error("amount must be a non-negative integer in minor units");
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
