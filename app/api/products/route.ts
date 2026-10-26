import { NextResponse, type NextRequest } from "next/server";
import { parseFilters } from "@/lib/catalog/filters";
import { searchProducts } from "@/lib/catalog/queries";
import { jsonError, rateLimited } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";

/** Public catalog search (published products only; RLS enforced in Postgres). */
export async function GET(req: NextRequest) {
  const rl = await enforceRateLimit(`products:${clientIp(req.headers)}`, 120, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  const params = Object.fromEntries(
    [...new Set(req.nextUrl.searchParams.keys())].map((k) => [k, req.nextUrl.searchParams.getAll(k)]),
  );
  try {
    const result = await searchProducts(parseFilters(params));
    return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch {
    return jsonError(500, "search_failed", "Search is temporarily unavailable.");
  }
}
