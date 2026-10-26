import { z } from "zod";
import { parseTakaToMinor } from "@/lib/money";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const taka = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const minor = parseTakaToMinor(v);
    if (minor == null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in taka, e.g. 1290" });
      return z.NEVER;
    }
    return minor;
  });

const optionalTaka = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const minor = parseTakaToMinor(v);
    if (minor == null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in taka" });
      return z.NEVER;
    }
    return minor;
  });

export const productSchema = z
  .object({
    title: z.string().trim().min(2, "Title is too short").max(140),
    slug: z.string().trim().max(120).optional().default(""),
    subtitle: z.string().trim().max(200).default(""),
    description: z.string().trim().max(8000).default(""),
    materials: z.string().trim().max(1000).default(""),
    care: z.string().trim().max(1000).default(""),
    category_id: z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
    audience: z.enum(["men", "women", "unisex"]),
    status: z.enum(["draft", "active", "archived"]).default("draft"),
    featured: z.boolean().default(false),
    tags: z
      .string()
      .default("")
      .transform((v) =>
        [...new Set(v.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30),
      )
      .pipe(z.array(z.string().max(40).regex(/^[a-z0-9 -]+$/, "Tags may use letters, numbers, spaces and dashes"))),
    seo_title: optionalText(70),
    seo_description: optionalText(170),
  })
  .transform((v) => ({ ...v, slug: v.slug ? v.slug : slugify(v.title) }))
  .refine((v) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.slug), { path: ["slug"], message: "Use lowercase letters, numbers and dashes" });

export const variantSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/, "SKU: 3–40 letters, numbers or dashes"),
    size: z.string().trim().min(1, "Required").max(20),
    color: z.string().trim().min(1, "Required").max(40),
    color_hex: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex colour like #36454F").nullable()),
    price: taka,
    compare_at: optionalTaka,
    cost: optionalTaka.optional(),
  })
  .refine((v) => v.compare_at == null || v.compare_at > v.price, {
    path: ["compare_at"],
    message: "Compare-at price must be higher than the price",
  });

export const variantUpdateSchema = z
  .object({
    price: taka,
    compare_at: optionalTaka,
    is_active: z.boolean(),
  })
  .refine((v) => v.compare_at == null || v.compare_at > v.price, {
    path: ["compare_at"],
    message: "Compare-at price must be higher than the price",
  });

export const stockAdjustSchema = z.object({
  warehouse_id: z.uuid(),
  movement_type: z.enum(["receive", "adjust", "damage", "return"]),
  delta: z.coerce
    .number()
    .int("Whole units only")
    .refine((n) => n !== 0, "Quantity cannot be zero")
    .refine((n) => Math.abs(n) <= 100000, "Too large"),
  reason: z.string().trim().min(3, "Give a reason (min 3 characters)").max(500),
  idempotency_key: z.uuid(),
});

export type FieldErrors = Record<string, string>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}
