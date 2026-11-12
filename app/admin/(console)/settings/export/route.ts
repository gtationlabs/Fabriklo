import { NextResponse } from "next/server";
import { getStaffState } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Downloads the non-secret store configuration as JSON (backup / moving to a new project). */
export async function GET() {
  const state = await getStaffState();
  if (state.kind !== "ok" || !state.staff.permissions.includes("settings.manage")) {
    return NextResponse.json({ error: { code: "forbidden", message: "Settings permission required." } }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const [settings, zones, methods] = await Promise.all([
    supabase.from("site_settings").select("key, value, is_public, updated_at").order("key"),
    supabase.from("shipping_zones").select("code, name, districts, is_fallback, fee_minor, free_over_minor, cod_enabled, estimate_min_days, estimate_max_days, is_active, position").order("position"),
    supabase.from("shipping_methods").select("code, name, description, fee_adjust_minor, estimate_min_days, estimate_max_days, cod_allowed, is_default, is_active, position").order("position"),
  ]);
  const body = { exported_at: new Date().toISOString(), note: "Non-secret configuration only. API keys and passwords are never exported.", site_settings: settings.data ?? [], shipping_zones: zones.data ?? [], shipping_methods: methods.data ?? [] };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="fabriklo-config-${body.exported_at.slice(0, 10)}.json"`, "Cache-Control": "no-store" },
  });
}
