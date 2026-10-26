import { randomBytes } from "node:crypto";
import type { PaymentProvider, SessionRequest, SessionResult, ValidationResult } from "./types";

/**
 * Sandbox MOCK gateway for local development and automated tests. It moves no
 * money and is never a real payment. It exists only so the full flow
 * (session → redirect → server-side validation → settle → stock commit) can be
 * exercised without SSLCOMMERZ credentials, and it is only selectable when
 * no real credentials are configured (see ./index.ts).
 *
 * The "gateway page" lives at /pay/mock/[tranId]; its buttons post the chosen
 * outcome, which the server turns into a mock `val_id` and validates here.
 */
export const MOCK_LABEL = "Sandbox mock gateway (not a real payment)";

export type MockLookup = (tranId: string) => Promise<{ amountMinor: number; currency: string } | null>;

export function mockValId(outcome: "valid" | "failed" | "cancelled", tranId: string) {
  return `MOCK-${outcome}-${tranId}-${randomBytes(6).toString("hex")}`;
}

export function createMockProvider(lookup: MockLookup, siteUrl: string): PaymentProvider {
  return {
    id: "mock",
    label: MOCK_LABEL,
    isLive: false,
    isMock: true,
    async createSession(req: SessionRequest): Promise<SessionResult> {
      return { ok: true, redirectUrl: `${siteUrl}/pay/mock/${encodeURIComponent(req.tranId)}`, sessionKey: `mock-${randomBytes(8).toString("hex")}` };
    },
    async validate(valId: string): Promise<ValidationResult> {
      const m = /^MOCK-(valid|failed|cancelled)-(FBK-\d{6,10}-\d{1,3})-[a-f0-9]{12}$/.exec(valId);
      const empty: ValidationResult = { outcome: "unknown", tranId: null, amountMinor: null, currency: null, valId, bankTranId: null, cardType: null, riskLevel: null, raw: { mock: true } };
      if (!m) return empty;
      const tx = await lookup(m[2]!);
      if (!tx) return empty;
      return {
        outcome: m[1] as ValidationResult["outcome"],
        tranId: m[2]!,
        amountMinor: tx.amountMinor,
        currency: tx.currency,
        valId,
        bankTranId: `MOCKBANK-${m[2]}`,
        cardType: "MOCK-Sandbox",
        riskLevel: "0",
        raw: { mock: true, outcome: m[1] },
      };
    },
    verifyIpnSignature() {
      return true;
    },
  };
}
