import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Shape returned by public.admin_dashboard_stats (migration 20261112000400). Sections are absent when the role lacks the permission. */
export type DashboardStats = {
  days: number;
  from: string;
  to: string;
  generated_at: string;
  scope: Record<"sales" | "orders" | "risk" | "catalog" | "inventory" | "customers" | "reviews" | "activity", boolean>;
  sales?: {
    revenue_minor: number;
    orders: number;
    aov_minor: number;
    prev_revenue_minor: number;
    prev_orders: number;
    prev_aov_minor: number;
    today_revenue_minor: number;
    units: number;
    daily: { d: string; revenue_minor: number; orders: number }[];
    payment_mix: { method: "cod" | "sslcommerz"; revenue_minor: number; orders: number }[];
    cod_due_minor: number;
    cod_due_orders: number;
    top_products: { title: string; units: number; revenue_minor: number }[];
    by_category: { name: string; revenue_minor: number; units: number }[];
  };
  orders?: {
    today: number;
    placed: number;
    prev_placed: number;
    cancelled: number;
    delivered: number;
    all_time: number;
    demo: number;
    pipeline: { to_confirm: number; processing: number; shipping: number; problem: number };
    daily: { d: string; orders: number }[];
    open_leads: number;
    recent: {
      id: string;
      order_number: string;
      customer_name: string;
      placed_at: string;
      payment_method: string;
      payment_status: string;
      fulfillment_status: string;
      shipment_status: string;
      risk_review_status: string;
      is_demo: boolean;
      items: number;
      total_minor: number | null;
    }[];
  };
  risk?: { needs_review: number; high_open: number };
  catalog?: {
    active: number;
    draft: number;
    archived: number;
    featured: number;
    tryon: number;
    categories: number;
    active_categories: number;
    new_products: number;
    by_category: { name: string; products: number }[];
  };
  inventory?: { skus: number; units_available: number; units_on_hand: number; reserved: number; low: number; out: number };
  customers?: { total: number; new: number; prev_new: number; buyers: number | null; repeat_buyers: number | null };
  reviews?: { pending: number; approved: number; avg_rating: number | null };
  activity?: { id: number; occurred_at: string; action: string; entity_type: string; actor_role: string | null; actor_name: string }[];
};

export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export function parseRange(value: unknown): DashboardRange {
  const n = Number(value);
  return (DASHBOARD_RANGES as readonly number[]).includes(n) ? (n as DashboardRange) : 30;
}

export type DashboardResult =
  | { kind: "ok"; stats: DashboardStats }
  /** The database does not have migration 20261112000400 yet. */
  | { kind: "missing_migration" }
  | { kind: "error"; message: string };

export async function loadDashboardStats(days: DashboardRange): Promise<DashboardResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_dashboard_stats", { p_days: days });
  if (error) {
    // PGRST202: function not in the schema cache; 42883: undefined function.
    if (error.code === "PGRST202" || error.code === "42883") return { kind: "missing_migration" };
    return { kind: "error", message: error.message };
  }
  return { kind: "ok", stats: data as DashboardStats };
}

/** Percentage change vs the previous period; null when there is no base to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}
