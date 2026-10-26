import { NextResponse, type NextRequest } from "next/server";
import { getQuote } from "@/lib/checkout/service";
import { quoteRequestSchema } from "@/lib/checkout/schema";
import { forbiddenOrigin, jsonError, rateLimited, zodError } from "@/lib/security/http";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const rl = rateLimit(`quote:${clientIp(req.headers)}`, 60, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  if (Number(req.headers.get("content-length") ?? 0) > 1_000) return jsonError(413, "too_large", "Request too large.");
  const parsed = quoteRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const quote = await getQuote(parsed.data.district ?? null);
  if (!quote) return jsonError(404, "cart_missing", "Your cart has expired.");
  return NextResponse.json(quote, { headers: { "Cache-Control": "private, no-store" } });
}
