import { z } from "zod";
import { parseTakaToMinor } from "@/lib/money";

export const SORTS = ["newest", "price_asc", "price_desc", "featured"] as const;
export type Sort = (typeof SORTS)[number];
export const PAGE_SIZE = 12;

export type CatalogFilters = {
  q: string | null;
  category: string | null;
  audience: "men" | "women" | null;
  collection: string | null;
  sizes: string[];
  colors: string[];
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  inStock: boolean;
  sort: Sort;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);
const label = z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N} .'-]+$/u);

function list(v: string | string[] | undefined): string[] {
  const arr = Array.isArray(v) ? v : v ? v.split(",") : [];
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))].slice(0, 12);
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parses URL search params into validated filters. Invalid values are dropped, never thrown. */
export function parseFilters(params: RawParams, fixed: Partial<CatalogFilters> = {}): CatalogFilters {
  const q = first(params.q)?.trim().slice(0, 80) || null;
  const category = slug.safeParse(first(params.category)).data ?? null;
  const collection = slug.safeParse(first(params.collection)).data ?? null;
  const audienceRaw = first(params.audience);
  const audience = audienceRaw === "men" || audienceRaw === "women" ? audienceRaw : null;
  const sizes = list(params.size).filter((s) => label.safeParse(s).success);
  const colors = list(params.color).filter((s) => label.safeParse(s).success);
  const min = first(params.min) ? parseTakaToMinor(first(params.min)!) : null;
  const max = first(params.max) ? parseTakaToMinor(first(params.max)!) : null;
  const sortRaw = first(params.sort);
  const sort = (SORTS as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as Sort) : "newest";
  const pageNum = Number(first(params.page) ?? "1");
  const page = Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= 500 ? pageNum : 1;

  return {
    q,
    category,
    audience,
    collection,
    sizes,
    colors,
    minPriceMinor: min,
    maxPriceMinor: max != null && min != null && max < min ? null : max,
    inStock: first(params.in_stock) === "1",
    sort,
    page,
    ...fixed,
  };
}

/** Serialises filters back into a query string (stable order, defaults omitted). */
export function filtersToQuery(f: Partial<CatalogFilters>, omit: (keyof CatalogFilters)[] = []): string {
  const p = new URLSearchParams();
  const skip = new Set(omit);
  if (f.q && !skip.has("q")) p.set("q", f.q);
  if (f.category && !skip.has("category")) p.set("category", f.category);
  if (f.audience && !skip.has("audience")) p.set("audience", f.audience);
  if (f.collection && !skip.has("collection")) p.set("collection", f.collection);
  if (f.sizes?.length && !skip.has("sizes")) p.set("size", f.sizes.join(","));
  if (f.colors?.length && !skip.has("colors")) p.set("color", f.colors.join(","));
  if (f.minPriceMinor != null && !skip.has("minPriceMinor")) p.set("min", String(f.minPriceMinor / 100));
  if (f.maxPriceMinor != null && !skip.has("maxPriceMinor")) p.set("max", String(f.maxPriceMinor / 100));
  if (f.inStock && !skip.has("inStock")) p.set("in_stock", "1");
  if (f.sort && f.sort !== "newest" && !skip.has("sort")) p.set("sort", f.sort);
  if (f.page && f.page > 1 && !skip.has("page")) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
