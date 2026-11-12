import { NextResponse, type NextRequest } from "next/server";
import { captureLead } from "@/lib/checkout/service";
import { leadRequestSchema } from "@/lib/checkout/schema";
import { forbiddenOrigin, jsonError, rateLimited, zodError } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

/** Checkout lead capture: called (debounced) once the shopper has typed a valid mobile number. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const rl = await enforceRateLimit(`lead:${clientIp(req.headers)}`, 20, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  if (Number(req.headers.get("content-length") ?? 0) > 2_000) return jsonError(413, "too_large", "Request too large.");
  const parsed = leadRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const saved = await captureLead(parsed.data);
  return NextResponse.json({ saved }, { headers: { "Cache-Control": "private, no-store" } });
}
