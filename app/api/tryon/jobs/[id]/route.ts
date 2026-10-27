import { NextResponse, type NextRequest } from "next/server";
import { getCustomer } from "@/lib/account/session";
import { deleteJob, getJob } from "@/lib/tryon/service";
import { tryonMessageFor } from "@/lib/tryon/types";
import { forbiddenOrigin, jsonError } from "@/lib/security/http";
import { isSameOrigin } from "@/lib/security/request";

/** The caller's own job (RLS scopes it); photos come back as short-lived signed URLs. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tryon/jobs/[id]">) {
  const customer = await getCustomer();
  if (!customer) return jsonError(401, "sign_in", "Sign in to use try-on.");
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return jsonError(404, "not_found", "Try-on not found.");
  return NextResponse.json({ ...job, message: job.status === "failed" ? tryonMessageFor(job.error_code) : null }, { headers: { "Cache-Control": "no-store" } });
}

/** Erases the photos and the job. */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/tryon/jobs/[id]">) {
  if (!isSameOrigin(req.headers, req.url)) return forbiddenOrigin();
  const customer = await getCustomer();
  if (!customer) return jsonError(401, "sign_in", "Sign in to use try-on.");
  const { id } = await ctx.params;
  const ok = await deleteJob(id);
  if (!ok) return jsonError(404, "not_found", "Try-on not found.");
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
}
