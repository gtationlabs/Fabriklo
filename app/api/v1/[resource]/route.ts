import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { jsonError, rateLimited } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabasePublicClient } from "@/lib/supabase/public";

const RESOURCES = new Set(["products", "orders", "inventory"]);

/** Read-only API for the owner's other tools. Keys are made in Admin → Settings → API & Webhooks. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!RESOURCES.has(resource)) return jsonError(404, "not_found", "Unknown resource.");
  const auth = req.headers.get("authorization") ?? "";
  const key = /^Bearer (fbk_[A-Za-z0-9_-]{20,80})$/.exec(auth)?.[1];
  if (!key) return jsonError(401, "unauthorized", "Send an API key as: Authorization: Bearer fbk_…");
  const hash = createHash("sha256").update(key).digest("hex");
  const rl = await enforceRateLimit(`api:${hash.slice(0, 16)}`, 60, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  const sinceRaw = req.nextUrl.searchParams.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100) || 100));
  const { data, error } = await createSupabasePublicClient().rpc("api_v1_read", { p_key_hash: hash, p_resource: resource, p_since: since, p_limit: limit });
  if (error) {
    if (error.hint === "unauthorized") return jsonError(401, "unauthorized", "Invalid, revoked or expired API key.");
    if (error.hint === "forbidden") return jsonError(403, "forbidden", `This key cannot read ${resource}.`);
    return jsonError(500, "error", "Something went wrong.");
  }
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
}
