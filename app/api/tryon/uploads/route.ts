import { NextResponse, type NextRequest } from "next/server";
import { getCustomer } from "@/lib/account/session";
import { TRYON_MAX_BYTES, PREPARE_MESSAGES } from "@/lib/tryon/images";
import { TryonError, uploadPhoto } from "@/lib/tryon/service";
import { forbiddenOrigin, jsonError, rateLimited } from "@/lib/security/http";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/security/request";

/**
 * Customer photo upload for try-on. Signed-in customers only; the file is
 * checked by content (not by its declared type), re-encoded without metadata
 * and stored under the customer's own private folder. Returns the storage
 * path only, never a public URL.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const customer = await getCustomer();
  if (!customer) return jsonError(401, "sign_in", "Sign in to use try-on.");
  const rl = rateLimit(`tryon-upload:${customer.id}`, 20, 60 * 60_000);
  const rlIp = rateLimit(`tryon-upload-ip:${clientIp(req.headers)}`, 40, 60 * 60_000);
  if (!rl.ok || !rlIp.ok) return rateLimited(Math.max(rl.retryAfterSeconds, rlIp.retryAfterSeconds));
  if (Number(req.headers.get("content-length") ?? 0) > TRYON_MAX_BYTES + 4096) return jsonError(413, "too_large", PREPARE_MESSAGES.too_large);
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("photo");
  if (!(file instanceof File)) return jsonError(422, "invalid_input", "Choose a photo to upload.");
  if (file.size > TRYON_MAX_BYTES) return jsonError(413, "too_large", PREPARE_MESSAGES.too_large);
  try {
    const result = await uploadPhoto(customer.id, new Uint8Array(await file.arrayBuffer()));
    if ("error" in result) return jsonError(422, result.error, PREPARE_MESSAGES[result.error]);
    return NextResponse.json({ path: result.path, width: result.width, height: result.height }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof TryonError) return jsonError(e.status, e.code, e.message);
    return jsonError(500, "unknown", "We couldn't save your photo. Please try again.");
  }
}
