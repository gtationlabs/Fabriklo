import { z } from "zod";

/**
 * Storefront theme tokens. A CLOSED set of keys with strict value formats,
 * checked here AND by private.theme_tokens_valid in SQL. Only values that pass
 * this schema are ever turned into CSS, so no free text reaches a stylesheet.
 */
export const COLOR_KEYS = [
  "cream",
  "paper",
  "sand",
  "wood",
  "bronze",
  "bronze_strong",
  "espresso",
  "charcoal",
  "muted",
  "line",
  "danger",
  "success",
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABELS: Record<ColorKey, { label: string; hint: string }> = {
  paper: { label: "Page background", hint: "Main background behind content" },
  cream: { label: "Soft surface", hint: "Cards, panels and button text on dark" },
  sand: { label: "Accent surface", hint: "Subtle highlights" },
  line: { label: "Borders", hint: "Dividers and input borders" },
  charcoal: { label: "Body text", hint: "Default text colour" },
  espresso: { label: "Headings and dark surfaces", hint: "Headings, footer, primary buttons" },
  muted: { label: "Secondary text", hint: "Hints and captions" },
  wood: { label: "Wood accent", hint: "Decorative accent" },
  bronze: { label: "Accent", hint: "Links, focus rings, highlights" },
  bronze_strong: { label: "Strong accent", hint: "Primary action buttons" },
  danger: { label: "Error", hint: "Errors and destructive actions" },
  success: { label: "Success", hint: "Confirmations" },
};

export const DISPLAY_FONTS = {
  cormorant: { label: "Cormorant Garamond (serif)", cssVar: "--font-cormorant" },
  playfair: { label: "Playfair Display (serif)", cssVar: "--font-playfair" },
  fraunces: { label: "Fraunces (soft serif)", cssVar: "--font-fraunces" },
} as const;
export const BODY_FONTS = {
  inter: { label: "Inter (sans)", cssVar: "--font-inter" },
  manrope: { label: "Manrope (sans)", cssVar: "--font-manrope" },
  dm_sans: { label: "DM Sans (sans)", cssVar: "--font-dm-sans" },
} as const;
export type DisplayFont = keyof typeof DISPLAY_FONTS;
export type BodyFont = keyof typeof BODY_FONTS;

export const RADII = {
  none: { label: "Square corners", scale: 0 },
  sm: { label: "Slightly rounded", scale: 1 },
  md: { label: "Rounded", scale: 2 },
  lg: { label: "Very rounded", scale: 4 },
} as const;
export type Radius = keyof typeof RADII;

const hex = z.string().regex(/^#[0-9a-f]{6}$/, "Use a 6-digit hex colour such as #7a5236");

export const themeTokensSchema = z
  .object({
    colors: z.object(Object.fromEntries(COLOR_KEYS.map((k) => [k, hex])) as Record<ColorKey, typeof hex>).strict(),
    fonts: z
      .object({
        display: z.enum(Object.keys(DISPLAY_FONTS) as [DisplayFont, ...DisplayFont[]]),
        body: z.enum(Object.keys(BODY_FONTS) as [BodyFont, ...BodyFont[]]),
      })
      .strict(),
    radius: z.enum(Object.keys(RADII) as [Radius, ...Radius[]]),
  })
  .strict();
export type ThemeTokens = z.infer<typeof themeTokensSchema>;

/** The values app/globals.css ships with (used when nothing is published). */
export const DEFAULT_THEME: ThemeTokens = {
  colors: {
    cream: "#f6f0e6",
    paper: "#fbf8f3",
    sand: "#e7dccb",
    wood: "#7a5236",
    bronze: "#9c6b30",
    bronze_strong: "#7c521f",
    espresso: "#2b1d14",
    charcoal: "#2e2b28",
    muted: "#6b625a",
    line: "#d9cdbb",
    danger: "#a1301f",
    success: "#2f6b3a",
  },
  fonts: { display: "cormorant", body: "inter" },
  radius: "sm",
};

/** Normalises user input (upper-case hex, 3-digit hex) before validation. */
export function normaliseHex(input: string): string {
  const v = input.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return v;
}

/**
 * CSS custom properties for validated tokens. Values are re-validated here so a
 * row that somehow bypassed the database check still cannot inject CSS.
 */
export function themeCss(tokens: ThemeTokens): string {
  const t = themeTokensSchema.parse(tokens);
  const r = RADII[t.radius].scale;
  const lines = [
    ...COLOR_KEYS.map((k) => `--color-${k.replace("_", "-")}:${t.colors[k]}`),
    `--font-display:var(${DISPLAY_FONTS[t.fonts.display].cssVar})`,
    `--font-body:var(${BODY_FONTS[t.fonts.body].cssVar})`,
    `--ui-radius-sm:${(0.25 * r).toFixed(3)}rem`,
    `--ui-radius-md:${(0.375 * r).toFixed(3)}rem`,
    `--ui-radius-lg:${(0.5 * r).toFixed(3)}rem`,
    `--ui-radius-xl:${(0.75 * r).toFixed(3)}rem`,
  ];
  return `:root{${lines.join(";")}}`;
}

/** Inline style object for previews (same mapping as themeCss, scoped to an element). */
export function themeStyle(tokens: ThemeTokens): Record<string, string> {
  const css = themeCss(tokens).slice(6, -1);
  return Object.fromEntries(css.split(";").map((pair) => pair.split(":") as [string, string]));
}

// --- Accessibility: WCAG 2.x contrast -----------------------------------------
function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
export function luminance(hexColor: string): number {
  const h = normaliseHex(hexColor);
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastCheck = { pair: string; fg: ColorKey; bg: ColorKey; ratio: number; minimum: number; ok: boolean };

/** The colour pairs the storefront actually uses for text; 4.5:1 is WCAG AA for body text. */
export function contrastChecks(tokens: ThemeTokens): ContrastCheck[] {
  const pairs: [string, ColorKey, ColorKey, number][] = [
    ["Body text on page background", "charcoal", "paper", 4.5],
    ["Body text on soft surface", "charcoal", "cream", 4.5],
    ["Secondary text on page background", "muted", "paper", 4.5],
    ["Headings on page background", "espresso", "paper", 4.5],
    ["Light text on dark surfaces", "cream", "espresso", 4.5],
    ["Button text on strong accent", "cream", "bronze_strong", 4.5],
    ["Accent links on page background", "bronze", "paper", 3],
    ["Error text on page background", "danger", "paper", 4.5],
  ];
  return pairs.map(([pair, fg, bg, minimum]) => {
    const ratio = contrastRatio(tokens.colors[fg], tokens.colors[bg]);
    return { pair, fg, bg, ratio: Math.round(ratio * 100) / 100, minimum, ok: ratio >= minimum };
  });
}
