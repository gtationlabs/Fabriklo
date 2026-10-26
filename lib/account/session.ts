import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Customer = { id: string; email: string | null; fullName: string; phone: string | null; marketingOptIn: boolean };

/** The signed-in customer (verified JWT + their profile row), or null. */
export const getCustomer = cache(async (): Promise<Customer | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name, phone, marketing_opt_in, is_disabled").eq("id", claims.sub).maybeSingle();
  if (profile?.is_disabled) return null;
  return {
    id: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    fullName: profile?.full_name ?? "",
    phone: profile?.phone ?? null,
    marketingOptIn: profile?.marketing_opt_in ?? false,
  };
});

export type Address = {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  address_line: string;
  postal_code: string | null;
  is_default: boolean;
};

export async function getAddresses(): Promise<Address[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("addresses")
    .select("id, label, recipient_name, phone, division, district, area, address_line, postal_code, is_default")
    .order("is_default", { ascending: false })
    .order("created_at");
  return (data ?? []) as Address[];
}
