import "server-only";
import { cache } from "react";
import { z } from "zod";
import { createSupabasePublicClient } from "@/lib/supabase/public";

/**
 * Public, non-secret store settings (site_settings rows with is_public = true).
 * The brand name is a setting, not a constant: the owner has not confirmed it.
 */
export const storeIdentitySchema = z.object({
  name: z.string().trim().min(2).max(60),
  tagline: z.string().trim().max(120).default(""),
  currency: z.literal("BDT").default("BDT"),
  locale: z.enum(["en-BD", "bn-BD"]).default("en-BD"),
});
export type StoreIdentity = z.infer<typeof storeIdentitySchema>;

export const storeContactSchema = z.object({
  email: z.string().trim().email().max(120),
  phone: z.string().trim().regex(/^\+8801[3-9][0-9]{8}$/),
  address: z.string().trim().max(200).default(""),
  hours: z.string().trim().max(120).default(""),
  note: z.string().trim().max(200).default(""),
});
export type StoreContact = z.infer<typeof storeContactSchema>;

export const DEFAULT_IDENTITY: StoreIdentity = { name: "Fabriklo", tagline: "Considered clothing for everyday Dhaka", currency: "BDT", locale: "en-BD" };

export const getStoreIdentity = cache(async (): Promise<StoreIdentity> => {
  try {
    const { data } = await createSupabasePublicClient().from("site_settings").select("value").eq("key", "store.identity").maybeSingle();
    const parsed = storeIdentitySchema.safeParse(data?.value);
    if (parsed.success) return parsed.data;
  } catch {
    // defaults below
  }
  return DEFAULT_IDENTITY;
});

export const getStoreContact = cache(async (): Promise<StoreContact | null> => {
  try {
    const { data } = await createSupabasePublicClient().from("site_settings").select("value").eq("key", "store.contact").maybeSingle();
    const parsed = storeContactSchema.safeParse(data?.value);
    if (parsed.success) return parsed.data;
  } catch {
    // null below
  }
  return null;
});
