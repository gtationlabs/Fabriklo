import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, DM_Sans, Fraunces, Inter, Manrope, Playfair_Display } from "next/font/google";
import { getStoreIdentity } from "@/lib/settings/public";
import { getPublishedTheme } from "@/lib/theme/service";
import { themeCss } from "@/lib/theme/tokens";
import "./globals.css";

/*
 * Every font the theme editor can choose is self-hosted by next/font. Only the
 * defaults are preloaded; the others download when a published theme uses them.
 */
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], display: "swap", preload: false });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], display: "swap", preload: false });
const cormorant = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", preload: false });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", preload: false });
const FONT_CLASSES = [inter, manrope, dmSans, cormorant, playfair, fraunces].map((f) => f.variable).join(" ");

export async function generateMetadata(): Promise<Metadata> {
  const identity = await getStoreIdentity();
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
    title: { default: `${identity.name} — ${identity.tagline || "Considered clothing"}`, template: `%s | ${identity.name}` },
    description: "Everyday clothing for Bangladesh: tees, shirts, trousers and layers, delivered nationwide.",
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { tokens } = await getPublishedTheme();
  return { themeColor: tokens.colors.espresso };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { tokens, published } = await getPublishedTheme();
  return (
    <html lang="en" className={`${FONT_CLASSES} h-full antialiased`}>
      <head>
        {/* Validated tokens only (see lib/theme/tokens.ts): hex colours, font variable names and rem radii. */}
        <style id="theme-vars" data-theme-published={published ? "1" : "0"} dangerouslySetInnerHTML={{ __html: themeCss(tokens) }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
