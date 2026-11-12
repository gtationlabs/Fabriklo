import { z } from "zod";
import { BD_DISTRICTS, normalizeBdPhone } from "@/lib/geo/bd";

const district = z.string().refine((d) => BD_DISTRICTS.includes(d), "Choose your district");

export const quoteRequestSchema = z.object({ district: district.nullable().optional() });

export const leadRequestSchema = z.object({
  name: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(20).transform((v, ctx) => {
    const p = normalizeBdPhone(v);
    if (!p) {
      ctx.addIssue({ code: "custom", message: "Enter a Bangladesh mobile number" });
      return z.NEVER;
    }
    return p;
  }),
  email: z.string().trim().max(254).optional(),
  district: z.string().max(60).optional(),
  addressLine: z.string().trim().max(300).optional(),
});

export const shippingMethodRequestSchema = z.object({ code: z.string().regex(/^[a-z0-9_-]{2,40}$/) });

export type ShippingOption = { code: string; name: string; description: string; fee_adjust_minor: number; min_days: number | null; max_days: number | null; cod_allowed: boolean };

/** Shared by the checkout form (client) and the order API (server). The DB validates again. */
export const placeOrderSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,120}$/),
  name: z.string().trim().min(2, "Enter your full name").max(120),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const p = normalizeBdPhone(v);
      if (!p) {
        ctx.addIssue({ code: "custom", message: "Enter a Bangladesh mobile number, e.g. 01712 345678" });
        return z.NEVER;
      }
      return p;
    }),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined))
    .refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email or leave it blank"),
  district,
  area: z.string().trim().min(2, "Enter your area or thana").max(80),
  addressLine: z.string().trim().min(5, "Enter house, road and any landmark").max(300),
  postalCode: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{4}$/.test(v), "Postcodes have 4 digits"),
  note: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(["cod", "sslcommerz"]),
  expectedTotalMinor: z.number().int().nonnegative(),
  // Cloudflare Turnstile token (present only when the challenge is configured).
  turnstileToken: z.string().max(2048).optional(),
});

export type PlaceOrderInput = z.input<typeof placeOrderSchema>;

export type Quote = {
  currency: "BDT";
  lines: {
    variant_id: string;
    title: string;
    sku: string;
    size: string;
    color: string;
    quantity: number;
    unit_price_minor: number;
    line_total_minor: number;
    available: number;
    purchasable: boolean;
  }[];
  issues: { sku: string; title: string; problem: "unavailable" | "insufficient_stock"; available: number }[];
  subtotal_minor: number;
  discount_minor: number;
  promotions: { promotion_id: string; kind: "coupon" | "automatic"; code: string | null; name: string; discount_minor: number; free_shipping: boolean }[];
  coupon: { code: string; status: string; name?: string; discount_minor?: number; min_subtotal_minor?: number } | null;
  tax_minor: number;
  shipping_minor: number | null;
  total_minor: number | null;
  zone: { code: string; name: string; min_days: number; max_days: number } | null;
  shipping_method?: string | null;
  shipping_methods?: ShippingOption[];
  district_known: boolean;
  cod_available: boolean;
  cod_max_order_minor: number | null;
};
