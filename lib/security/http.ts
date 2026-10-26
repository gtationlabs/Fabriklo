import { NextResponse } from "next/server";
import type { ZodError } from "zod";

/** Uniform JSON error envelope. Never leaks stack traces or SQL details. */
export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers: { "Cache-Control": "no-store" } });
}

export function zodError(err: ZodError) {
  return jsonError(422, "invalid_input", "Some fields are invalid.", {
    fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

export function rateLimited(retryAfterSeconds: number) {
  const res = jsonError(429, "rate_limited", "Too many requests. Please slow down.");
  res.headers.set("Retry-After", String(retryAfterSeconds));
  return res;
}

export function forbiddenOrigin() {
  return jsonError(403, "bad_origin", "Cross-site request rejected.");
}
