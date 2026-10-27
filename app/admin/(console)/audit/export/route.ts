import { NextResponse, type NextRequest } from "next/server";
import { auditCsv, parseAuditFilters } from "@/lib/admin/audit";
import { auditActors, queryAudit } from "@/lib/admin/audit-query";
import { checkStaff } from "@/lib/auth/staff";

/** CSV of the filtered audit log (audit.read). Masked like the screen; capped at 5,000 rows. */
export async function GET(req: NextRequest) {
  const auth = await checkStaff("audit.read");
  if (!auth.ok) return new NextResponse("Forbidden", { status: 403 });
  const filters = parseAuditFilters(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const [rows, actors] = await Promise.all([queryAudit(filters, 5000), auditActors()]);
  return new NextResponse(auditCsv(rows, actors), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=audit-log.csv", "Cache-Control": "no-store" },
  });
}
