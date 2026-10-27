import "server-only";
import { publicEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createMockProvider } from "./mock";
import { createSslcommerzProvider } from "./sslcommerz";
import { selectProvider, type ProviderEnv } from "./select";
import type { PaymentProvider } from "./types";

export { selectProvider };

export function getPaymentProvider(): PaymentProvider | null {
  const env = process.env as ProviderEnv;
  const choice = selectProvider(env);
  if (choice === "sslcommerz") {
    return createSslcommerzProvider({
      storeId: env.SSLCOMMERZ_STORE_ID!,
      storePassword: env.SSLCOMMERZ_STORE_PASSWORD!,
      sandbox: env.SSLCOMMERZ_SANDBOX !== "false",
    });
  }
  if (choice === "mock") {
    return createMockProvider(async (tranId) => {
      const { data } = await createSupabaseServiceClient()
        .from("payment_transactions")
        .select("amount_minor, currency")
        .eq("tran_id", tranId)
        .maybeSingle();
      return data ? { amountMinor: Number(data.amount_minor), currency: data.currency } : null;
    }, publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, ""));
  }
  return null;
}

/** What the checkout page needs to offer "Pay online" (no secrets). */
export function onlinePaymentOffer(): { label: string; isMock: boolean; isLive: boolean } | null {
  const p = getPaymentProvider();
  return p ? { label: p.label, isMock: p.isMock, isLive: p.isLive } : null;
}
