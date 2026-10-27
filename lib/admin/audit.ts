import { z } from "zod";

/**
 * Audit viewer helpers (pure, unit-tested). Rows are append-only in Postgres;
 * the viewer only filters, pages and masks them.
 */
export const auditFilterSchema = z.object({
  entity_type: z.string().trim().max(60).regex(/^[a-z0-9_.]*$/).default(""),
  action: z.string().trim().max(80).regex(/^[a-z0-9_.:-]*$/).default(""),
  actor: z.union([z.uuid(), z.literal("")]).default(""),
  entity_id: z.string().trim().max(120).default(""),
  from: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).default(""),
  to: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).default(""),
  before: z.coerce.number().int().positive().optional(),
});
export type AuditFilters = z.infer<typeof auditFilterSchema>;

export function parseAuditFilters(params: Record<string, string | string[] | undefined>): AuditFilters {
  const pick = (k: string) => (typeof params[k] === "string" ? params[k] : Array.isArray(params[k]) ? params[k]?.[0] : undefined);
  const parsed = auditFilterSchema.safeParse({
    entity_type: pick("entity_type") ?? "",
    action: pick("action") ?? "",
    actor: pick("actor") ?? "",
    entity_id: pick("entity_id") ?? "",
    from: pick("from") ?? "",
    to: pick("to") ?? "",
    before: pick("before") || undefined,
  });
  return parsed.success ? parsed.data : auditFilterSchema.parse({});
}

/** Keys whose values never belong on a screen, even to auditors. */
const SENSITIVE = /(^|_)(token|secret|password|hash|otp|api_key|key_hash|signature)(_|$)|_hash$|token_hash|^encrypted_/i;

/** Returns a deep copy with sensitive values replaced by "•••" (keys kept so reviewers see that a value changed). */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8) return "…";
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) && v !== null && v !== undefined ? "•••" : maskSensitive(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Top-level keys that differ between before and after (for the compact diff view). */
export function changedKeys(before: unknown, after: unknown): string[] {
  const b = (before && typeof before === "object" && !Array.isArray(before) ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" && !Array.isArray(after) ? after : {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).sort();
}

export type AuditRow = {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  before_data: unknown;
  after_data: unknown;
};

/** CSV with formula-injection protection; JSON columns are masked. */
export function auditCsv(rows: AuditRow[], actorNames: Map<string, string>): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&")}"`;
  const header = "id,occurred_at,actor,actor_role,action,entity_type,entity_id,reason,changed_keys,before,after";
  const lines = rows.map((r) =>
    [
      r.id,
      r.occurred_at,
      r.actor_id ? (actorNames.get(r.actor_id) ?? r.actor_id) : "system",
      r.actor_role ?? "",
      r.action,
      r.entity_type,
      r.entity_id ?? "",
      r.reason ?? "",
      changedKeys(r.before_data, r.after_data).join(" "),
      r.before_data == null ? "" : JSON.stringify(maskSensitive(r.before_data)),
      r.after_data == null ? "" : JSON.stringify(maskSensitive(r.after_data)),
    ]
      .map(esc)
      .join(","),
  );
  return [header, ...lines].join("\r\n");
}
