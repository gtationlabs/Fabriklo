const ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "One Size"];

/** Sorts apparel sizes naturally: letter sizes, then waist sizes, then one-size. */
export function compareSizes(a: string, b: string): number {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  const na = /^\d+$/.test(a) ? Number(a) : NaN;
  const nb = /^\d+$/.test(b) ? Number(b) : NaN;
  const rank = (i: number, n: number, s: string) =>
    s === "One Size" ? 3 : i >= 0 ? 1 : Number.isFinite(n) ? 2 : 4;
  const ra = rank(ia, na, a);
  const rb = rank(ib, nb, b);
  if (ra !== rb) return ra - rb;
  if (ra === 1) return ia - ib;
  if (ra === 2) return na - nb;
  return a.localeCompare(b);
}

export function sortSizes<T extends string>(sizes: T[]): T[] {
  return [...sizes].sort(compareSizes);
}
