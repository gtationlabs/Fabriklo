/** All money is integer minor units (poisha). 100 poisha = 1 BDT. */
const formatter = new Intl.NumberFormat("en-BD", {
  style: "currency",
  currency: "BDT",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatBDT(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return "";
  return formatter.format(minor / 100);
}

/** Parses a user-entered taka amount ("1,290" / "1290.50") into minor units. */
export function parseTakaToMinor(input: string): number | null {
  const cleaned = input.replace(/[,\s৳]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
