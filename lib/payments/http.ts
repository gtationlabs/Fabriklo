import "server-only";
import type { NextRequest } from "next/server";

/** Reads a gateway message (form-encoded POST, JSON, or query string) into flat strings. */
export async function formToRecord(req: NextRequest): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (Object.keys(out).length >= 80) return;
    if (/^[A-Za-z0-9_.-]{1,60}$/.test(k)) out[k] = String(v ?? "").slice(0, 1000);
  };
  const type = req.headers.get("content-type") ?? "";
  if (req.method === "POST") {
    if (type.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (body && typeof body === "object") for (const [k, v] of Object.entries(body)) put(k, v);
    } else {
      const fd = await req.formData().catch(() => null);
      if (fd) for (const [k, v] of fd.entries()) put(k, typeof v === "string" ? v : "");
    }
  }
  for (const [k, v] of req.nextUrl.searchParams.entries()) if (!(k in out)) put(k, v);
  return out;
}
