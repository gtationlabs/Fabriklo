import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { getCustomer } from "@/lib/account/session";
import { createJob, hashIp, runWorkerTick, TryonError } from "@/lib/tryon/service";
import { forbiddenOrigin, jsonError, rateLimited, zodError } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

const schema = z.object({
  variantId: z.uuid(),
  inputPath: z.string().regex(/^[0-9a-f-]{36}\/[A-Za-z0-9_.-]{1,120}$/),
  consent: z.literal(true),
  consentVersion: z.string().min(4).max(40),
});

/** Queues a try-on. The database enforces consent, garment support and quotas; the worker runs it. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const customer = await getCustomer();
  if (!customer) return jsonError(401, "sign_in", "Sign in to use try-on.");
  const ip = clientIp(req.headers);
  const rl = await enforceRateLimit(`tryon-jobs:${customer.id}`, 10, 60 * 60_000);
  const rlIp = await enforceRateLimit(`tryon-jobs-ip:${ip}`, 20, 60 * 60_000);
  if (!rl.ok || !rlIp.ok) return rateLimited(Math.max(rl.retryAfterSeconds, rlIp.retryAfterSeconds));
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  try {
    const { jobId } = await createJob(parsed.data.variantId, parsed.data.inputPath, parsed.data.consentVersion, hashIp(ip));
    // Start processing once this response is sent; the cron-driven worker covers retries and stragglers.
    after(() => runWorkerTick(3).catch((e) => console.warn(`[tryon] worker tick failed: ${(e as Error).message}`)));
    return NextResponse.json({ jobId }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof TryonError) return jsonError(e.status, e.code, e.message);
    return jsonError(500, "unknown", "We couldn't start the try-on. Please try again.");
  }
}
