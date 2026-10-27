import { NextResponse, type NextRequest } from "next/server";
import { getCourierAdapter } from "@/lib/couriers/registry";
import { jsonError, rateLimited } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Courier → server status webhook. Verified with the courier's secret, then
 * every event is handed to `courier_apply_event`, which de-duplicates and
 * applies only allowed shipment transitions. Unknown tracking numbers and
 * unmapped statuses are stored for staff to see, never applied.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/couriers/[courier]/webhook">) {
  const { courier } = await ctx.params;
  const adapter = getCourierAdapter(courier);
  if (!adapter || adapter.id === "manual" || !adapter.isConfigured()) return jsonError(404, "not_found", "No webhook for this courier.");
  const rl = await enforceRateLimit(`courier:${clientIp(req.headers)}`, 300, 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  if (Number(req.headers.get("content-length") ?? 0) > 100_000) return jsonError(413, "too_large", "Request too large.");
  const raw = await req.text();
  if (!adapter.verifyWebhook(req.headers, raw)) return jsonError(401, "bad_signature", "Signature check failed.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "bad_json", "Body must be JSON.");
  }
  const events = adapter.parseWebhook(body);
  const svc = createSupabaseServiceClient();
  const results: { eventId: string; duplicate: boolean; applied: boolean }[] = [];
  for (const e of events) {
    const { data, error } = await svc.rpc("courier_apply_event", {
      p_courier: adapter.id,
      p_event_id: e.eventId,
      p_tracking_number: e.trackingNumber,
      p_status: e.status,
      p_mapped: e.mapped,
      p_payload: body && typeof body === "object" ? (body as Record<string, unknown>) : {},
    });
    const r = (data ?? {}) as { duplicate?: boolean; applied?: boolean };
    results.push({ eventId: e.eventId, duplicate: !!r.duplicate, applied: !error && !!r.applied });
  }
  return NextResponse.json({ received: events.length, results }, { headers: { "Cache-Control": "no-store" } });
}
