import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runAutomationTick } from "@/lib/automation/service";

/**
 * Scheduler entry point (cron / uptime pinger): `Authorization: Bearer $AUTOMATION_WORKER_SECRET`.
 * Hidden (404) unless the secret is configured. The worker also runs after
 * checkout and newsletter requests, so this is a safety net, not the only trigger.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.AUTOMATION_WORKER_SECRET ?? "";
  if (secret.length < 16) return new NextResponse(null, { status: 404 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse(null, { status: 404 });
  try {
    const result = await runAutomationTick({ events: 500, messages: 50 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "worker failed" }, { status: 500 });
  }
}
