import { z } from "zod";

/**
 * Allow-listed page blocks. Plain text only: inline **bold** and [label](/path)
 * links are parsed by the renderer, never HTML. The database has the same
 * allow-list as a backstop (private.cms_blocks_valid).
 */
const internalHref = z.string().regex(/^\/([A-Za-z0-9_?=&.-][A-Za-z0-9/_?=&.-]{0,199})?$/, "Links must be internal paths such as /shop");
const text = (max: number) => z.string().trim().min(1).max(max);

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), text: text(120) }),
  z.object({ type: z.literal("paragraph"), text: text(2000) }),
  z.object({ type: z.literal("list"), style: z.enum(["bullet", "number"]), items: z.array(text(300)).min(1).max(30) }),
  z.object({ type: z.literal("faq"), items: z.array(z.object({ q: text(200), a: text(1000) })).min(1).max(30) }),
  z.object({ type: z.literal("callout"), tone: z.enum(["info", "warning"]), text: text(500) }),
  z.object({ type: z.literal("cta"), label: text(40), href: internalHref }),
  z.object({
    type: z.literal("image"),
    path: z.string().regex(/^\/assets\/[a-z0-9/_-]+\.(webp|jpg|png|avif)$/, "Images must come from /assets"),
    alt: text(300),
    caption: z.string().trim().max(200).optional(),
  }),
]);
export type Block = z.infer<typeof blockSchema>;
export const blocksSchema = z.array(blockSchema).max(60);

export const BLOCK_TYPES = ["heading", "paragraph", "list", "faq", "callout", "cta", "image"] as const;

export const pageSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes")
    .max(80),
  title: z.string().trim().min(1, "Add a title").max(140),
  page_kind: z.enum(["page", "legal", "help"]),
  seo_title: z.string().trim().max(70).optional(),
  seo_description: z.string().trim().max(170).optional(),
});

export type CmsPage = {
  slug: string;
  title: string;
  kind: "page" | "legal" | "help";
  seo_title: string | null;
  seo_description: string | null;
  blocks: Block[];
  version: number;
  published_at: string;
};

/** Splits inline text into plain, bold and internal-link segments (no HTML). */
export type Inline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "link"; text: string; href: string };

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[A-Za-z0-9/_?=&.-]*)\)/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index! > last) out.push({ kind: "text", text: src.slice(last, m.index) });
    if (m[1]) out.push({ kind: "bold", text: m[1] });
    else out.push({ kind: "link", text: m[2]!, href: m[3]! });
    last = m.index! + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out;
}
