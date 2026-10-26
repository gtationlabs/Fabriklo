import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { runAutomationTick } from "@/lib/automation/service";
import { forbiddenOrigin, jsonError, rateLimited, zodError } from "@/lib/security/http";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const schema = z.object({
  email: z.string().trim().max(254).refine((v) => z.email().safeParse(v).success, "Enter a valid email"),
  source: z.enum(["footer", "checkout", "popup", "account"]).default("footer"),
  // Honeypot: real people leave it empty.
  website: z.string().max(0).optional(),
});

/** Double opt-in subscribe. Always answers the same way so it cannot be used to check who is subscribed. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const ip = clientIp(req.headers);
  const rl = rateLimit(`newsletter:${ip}`, 5, 10 * 60_000);
  if (!rl.ok) return rateLimited(rl.retryAfterSeconds);
  if (Number(req.headers.get("content-length") ?? 0) > 1_000) return jsonError(413, "too_large", "Request too large.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const ipHash = createHash("sha256").update(`${ip}:${process.env.NOTIFY_TOKEN_SECRET ?? ""}`).digest("hex").slice(0, 32);
  const { error } = await createSupabaseServiceClient().rpc("newsletter_subscribe", { p_email: parsed.data.email, p_source: parsed.data.source, p_ip_hash: ipHash });
  if (error && error.hint !== "invalid_email") return jsonError(500, "unknown", "We couldn't save that right now. Please try again.");
  after(() => runAutomationTick({ events: 50, messages: 10 }).catch(() => undefined));
  return NextResponse.json({ ok: true, message: "Check your inbox to confirm your subscription." }, { headers: { "Cache-Control": "no-store" } });
}
