import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuditFilters, AuditRow } from "./audit";

/** Reads audit_events AS THE STAFF USER (RLS: audit.read), newest first, keyset-paged by id. */
export async function queryAudit(filters: AuditFilters, limit: number): Promise<AuditRow[]> {
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("audit_events")
    .select("id, occurred_at, actor_id, actor_role, action, entity_type, entity_id, reason, before_data, after_data")
    .order("id", { ascending: false })
    .limit(limit);
  if (filters.entity_type) q = q.eq("entity_type", filters.entity_type);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.actor) q = q.eq("actor_id", filters.actor);
  if (filters.entity_id) q = q.eq("entity_id", filters.entity_id);
  if (filters.from) q = q.gte("occurred_at", `${filters.from}T00:00:00Z`);
  if (filters.to) q = q.lte("occurred_at", `${filters.to}T23:59:59.999Z`);
  if (filters.before) q = q.lt("id", filters.before);
  const { data } = await q;
  return (data ?? []) as AuditRow[];
}

export async function auditActors(): Promise<Map<string, string>> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_audit_actors");
  const map = new Map<string, string>();
  for (const a of (data ?? []) as { user_id: string; display_name: string; role_code: string }[]) {
    map.set(a.user_id, a.display_name || a.user_id.slice(0, 8));
  }
  return map;
}
