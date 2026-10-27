import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runWorkerTick } from "@/lib/tryon/service";
import { jsonError } from "@/lib/security/http";

/**
 * Scheduler entry point (e.g. a host cron hitting this every minute with
 * `Authorization: Bearer $TRYON_WORKER_SECRET`). Runs queued jobs that were
 * not picked up right after creation, retries, and purges expired photos.
 * Without the secret configured the route does not exist.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.TRYON_WORKER_SECRET;
  if (!secret || secret.length < 16) return jsonError(404, "not_found", "Not found.");
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return jsonError(401, "unauthorized", "Unauthorized.");
  const report = await runWorkerTick(5);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
