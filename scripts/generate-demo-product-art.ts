/**
 * Draws one flat illustration per demo product (garment in its first colour on
 * a wooden hanger or laid flat) and writes it to
 * public/assets/demo/products/<slug>.webp. These are clearly drawings, not
 * photos, and are replaced as soon as staff upload a real photo in Admin.
 *
 *   npx tsx scripts/generate-demo-product-art.ts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { DEMO_PRODUCTS, type DemoProduct } from "../lib/catalog/demo-catalog";

const W = 800;
const H = 1000;
const OUT = path.join(process.cwd(), "public/assets/demo/products");

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

const HANGER = `
  <g fill="none" stroke="#8a6a4a" stroke-linecap="round" stroke-linejoin="round">
    <path d="M400 150 V122 a22 22 0 1 1 22 -22" stroke="#9a9a9a" stroke-width="7"/>
    <path d="M400 150 L250 215 Q240 222 252 224 L548 224 Q560 222 550 215 Z" stroke-width="12" fill="#a07a52"/>
  </g>`;

// Garment outlines (centre x = 400). Tops hang from the hanger's shoulders at y≈215.
const SHAPES = {
  tee: "M335 205 Q400 250 465 205 L590 240 L668 360 L590 398 L560 350 L562 790 Q400 806 238 790 L240 350 L210 398 L132 360 L210 240 Z",
  longSleeve: "M335 205 Q400 250 465 205 L590 240 L672 690 L606 704 L562 400 L562 800 Q400 816 238 800 L238 400 L194 704 L128 690 L210 240 Z",
  crop: "M335 205 Q400 250 465 205 L590 240 L668 360 L590 398 L560 350 L560 610 Q400 626 240 610 L240 350 L210 398 L132 360 L210 240 Z",
  tunic: "M335 205 Q400 250 465 205 L590 240 L672 690 L606 704 L566 400 L580 880 Q400 900 220 880 L234 400 L194 704 L128 690 L210 240 Z",
  coat: "M335 205 Q400 250 465 205 L595 240 L676 720 L610 734 L570 420 L600 905 Q400 925 200 905 L230 420 L190 734 L124 720 L205 240 Z",
  pants: "M262 170 L538 170 L566 870 L430 870 L400 400 L370 870 L234 870 Z",
  widePants: "M268 170 L532 170 L612 870 L428 870 L400 420 L372 870 L188 870 Z",
};

function body(d: DemoProduct, fill: string, line: string): string {
  const s = d.slug;
  const fold = (x1: number, y1: number, x2: number, y2: number) => `<path d="M${x1} ${y1} Q${(x1 + x2) / 2 + 12} ${(y1 + y2) / 2} ${x2} ${y2}" stroke="${line}" stroke-opacity=".35" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  const garment = (shape: string, extra = "") => `
    <path d="${shape}" fill="${fill}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/>
    <path d="${shape}" fill="url(#light)"/>
    ${extra}`;
  const collar = `<path d="M335 205 L400 280 L372 300 L318 222 Z M465 205 L400 280 L428 300 L482 222 Z" fill="${shade(fill, -0.08)}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/>`;
  const buttons = (from: number, to: number, step: number) => {
    let out = `<path d="M400 ${from - 20} V${to + 20}" stroke="${line}" stroke-opacity=".5" stroke-width="3"/>`;
    for (let y = from; y <= to; y += step) out += `<circle cx="412" cy="${y}" r="7" fill="${shade(fill, -0.15)}" stroke="${line}" stroke-width="2"/>`;
    return out;
  };
  const crewNeck = `<path d="M335 205 Q400 262 465 205" fill="none" stroke="${shade(fill, -0.2)}" stroke-width="12" stroke-linecap="round"/>`;

  switch (d.category) {
    case "t-shirts": {
      const extra =
        crewNeck +
        (s.includes("pocket") ? `<rect x="440" y="320" width="70" height="80" rx="6" fill="none" stroke="${line}" stroke-opacity=".6" stroke-width="4"/>` : "") +
        (s.includes("graphic") ? `<g transform="translate(400 470)"><circle r="72" fill="none" stroke="${line}" stroke-opacity=".7" stroke-width="8"/><path d="M-40 18 L-8 -30 L14 6 L28 -12 L48 18 Z" fill="${line}" fill-opacity=".6"/></g>` : "") +
        (s.includes("ribbed") ? Array.from({ length: 13 }, (_, i) => `<path d="M${262 + i * 23} 300 V780" stroke="${line}" stroke-opacity=".18" stroke-width="3"/>`).join("") : "") +
        fold(300, 520, 330, 760) + fold(500, 560, 470, 770);
      return garment(SHAPES.tee, extra);
    }
    case "shirts": {
      const shape = s.includes("tunic") ? SHAPES.tunic : SHAPES.longSleeve;
      const check = s.includes("check")
        ? `<g clip-path="url(#garment)" stroke="${shade(fill, 0.35)}" stroke-opacity=".55" stroke-width="10">${Array.from({ length: 12 }, (_, i) => `<path d="M${130 + i * 50} 200 V920"/><path d="M120 ${240 + i * 55} H680"/>`).join("")}</g>`
        : "";
      return `<clipPath id="garment"><path d="${shape}"/></clipPath>` + garment(shape, check + collar + buttons(320, s.includes("tunic") ? 800 : 740, 70) + fold(300, 460, 320, 760));
    }
    case "polos": {
      const shape = s.includes("long-sleeve") ? SHAPES.longSleeve : s.includes("cropped") ? SHAPES.crop : SHAPES.tee;
      const placket = `<rect x="388" y="250" width="24" height="${s.includes("resort") ? 0 : 110}" fill="${shade(fill, -0.06)}" stroke="${line}" stroke-width="3"/>` + (s.includes("resort") ? "" : `<circle cx="400" cy="290" r="6" fill="${line}"/><circle cx="400" cy="330" r="6" fill="${line}"/>`);
      const knit = s.includes("knit") || s.includes("pique") ? Array.from({ length: 10 }, (_, i) => `<path d="M250 ${420 + i * 36} H550" stroke="${line}" stroke-opacity=".12" stroke-width="3"/>`).join("") : "";
      return `<clipPath id="garment"><path d="${shape}"/></clipPath>` + garment(shape, `<g clip-path="url(#garment)">${knit}</g>` + collar + placket + fold(300, 480, 330, 600));
    }
    case "outerwear": {
      const shape = s.includes("trench") ? SHAPES.coat : SHAPES.longSleeve;
      let extra = `<path d="M400 250 V${s.includes("trench") ? 910 : 806}" stroke="${shade(fill, -0.3)}" stroke-width="6"/>`;
      if (s.includes("hoodie")) extra += `<path d="M330 210 Q300 120 400 110 Q500 120 470 210 Q400 260 330 210 Z" fill="${shade(fill, -0.1)}" stroke="${line}" stroke-width="5"/><path d="M380 260 V380 M420 260 V380" stroke="${line}" stroke-width="4"/><path d="M290 600 H510 L490 700 H310 Z" fill="none" stroke="${line}" stroke-opacity=".5" stroke-width="4"/>`;
      if (s.includes("bomber")) extra += `<clipPath id="garment"><path d="${shape}"/></clipPath><g clip-path="url(#garment)" stroke="${line}" stroke-opacity=".35" stroke-width="3">${Array.from({ length: 14 }, (_, i) => `<path d="M${100 + i * 45} 220 L${400 + i * 45} 900"/><path d="M${700 - i * 45} 220 L${400 - i * 45} 900"/>`).join("")}</g><rect x="238" y="770" width="324" height="36" fill="${shade(fill, -0.15)}"/><path d="M335 205 Q400 255 465 205" fill="none" stroke="${shade(fill, -0.2)}" stroke-width="18"/>`;
      if (s.includes("overshirt")) extra += `<clipPath id="garment"><path d="${shape}"/></clipPath><g clip-path="url(#garment)" stroke="${shade(fill, 0.3)}" stroke-opacity=".5" stroke-width="8">${Array.from({ length: 12 }, (_, i) => `<path d="M${130 + i * 50} 200 V920"/><path d="M120 ${240 + i * 55} H680"/>`).join("")}</g>${collar}<rect x="270" y="330" width="80" height="70" fill="none" stroke="${line}" stroke-width="4"/><rect x="450" y="330" width="80" height="70" fill="none" stroke="${line}" stroke-width="4"/>`;
      if (s.includes("trench")) extra += `<path d="M335 205 L300 420 L400 470 Z M465 205 L500 420 L400 470 Z" fill="${shade(fill, -0.08)}" stroke="${line}" stroke-width="4"/><rect x="216" y="540" width="370" height="34" fill="${shade(fill, -0.15)}" stroke="${line}" stroke-width="3"/><rect x="380" y="532" width="44" height="50" fill="none" stroke="${line}" stroke-width="5"/>`;
      return garment(shape, extra + fold(300, 500, 320, 780));
    }
    case "pants": {
      const shape = s.includes("wide") ? SHAPES.widePants : SHAPES.pants;
      const extra =
        `<rect x="262" y="170" width="276" height="40" fill="${shade(fill, -0.1)}" stroke="${line}" stroke-width="4"/>` +
        [300, 360, 440, 500].map((x) => `<rect x="${x - 5}" y="166" width="10" height="48" fill="${shade(fill, -0.2)}"/>`).join("") +
        (s.includes("jogger") ? `<rect x="236" y="830" width="132" height="40" fill="${shade(fill, -0.12)}"/><rect x="432" y="830" width="132" height="40" fill="${shade(fill, -0.12)}"/><path d="M380 210 Q370 270 360 290 M420 210 Q430 270 440 290" stroke="${line}" stroke-width="4" fill="none"/>` : "") +
        `<path d="M290 215 Q300 280 340 290 M510 215 Q500 280 460 290" stroke="${line}" stroke-opacity=".6" stroke-width="4" fill="none"/><path d="M400 210 V400" stroke="${line}" stroke-opacity=".6" stroke-width="3"/>` +
        (s.includes("herringbone") ? `<clipPath id="garment"><path d="${shape}"/></clipPath><g clip-path="url(#garment)" stroke="${line}" stroke-opacity=".25" stroke-width="2" fill="none">${Array.from({ length: 22 }, (_, i) => `<path d="M${180 + i * 22} 210 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20 l-11 20 l11 20"/>`).join("")}</g>` : "") +
        fold(310, 450, 300, 820) + fold(490, 450, 500, 820);
      return garment(shape, extra);
    }
    default: {
      if (s.includes("cap")) {
        return `<path d="M230 560 Q230 330 400 320 Q570 330 570 560 Z" fill="${fill}" stroke="${line}" stroke-width="5"/><path d="M230 560 Q230 330 400 320 Q570 330 570 560 Z" fill="url(#light)"/><path d="M560 540 Q690 545 720 600 Q640 620 560 590 Z" fill="${shade(fill, -0.12)}" stroke="${line}" stroke-width="5"/><path d="M400 322 V560 M310 345 Q330 450 320 560 M490 345 Q470 450 480 560" stroke="${line}" stroke-opacity=".5" stroke-width="4" fill="none"/><circle cx="400" cy="322" r="12" fill="${shade(fill, -0.2)}"/><path d="M230 560 H570" stroke="${line}" stroke-width="6"/>`;
      }
      if (s.includes("belt")) {
        return `<g transform="rotate(-8 400 500)"><rect x="110" y="450" width="560" height="70" rx="10" fill="${fill}" stroke="${line}" stroke-width="5"/><rect x="110" y="450" width="560" height="70" rx="10" fill="url(#light)"/>${[480, 530, 580].map((x) => `<circle cx="${x}" cy="485" r="7" fill="${shade(fill, -0.4)}"/>`).join("")}<rect x="160" y="430" width="120" height="110" rx="14" fill="none" stroke="#b8a27a" stroke-width="16"/><path d="M220 485 H300" stroke="#b8a27a" stroke-width="12" stroke-linecap="round"/><path d="M130 462 H660 M130 508 H660" stroke="${line}" stroke-opacity=".35" stroke-width="2" stroke-dasharray="10 8"/></g>`;
      }
      if (s.includes("tote")) {
        return `<path d="M310 400 Q310 210 400 210 Q490 210 490 400" fill="none" stroke="${shade(fill, -0.25)}" stroke-width="26"/><path d="M230 380 H570 L600 860 H200 Z" fill="${fill}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/><path d="M230 380 H570 L600 860 H200 Z" fill="url(#light)"/><path d="M226 440 H574" stroke="${line}" stroke-opacity=".4" stroke-width="4" stroke-dasharray="12 10"/>${fold(320, 520, 300, 820)}`;
      }
      // Socks: three in a fan.
      return [-14, 0, 14]
        .map((r, i) => {
          const f = shade(fill, [-0.25, 0, 0.3][i]);
          return `<g transform="rotate(${r} 400 700) translate(${(i - 1) * 130} 0)"><path d="M345 260 H455 V650 Q455 700 500 720 Q560 750 540 810 Q520 860 440 840 L370 820 Q340 800 345 740 Z" fill="${f}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/><rect x="345" y="260" width="110" height="60" fill="${shade(f, -0.15)}"/>${Array.from({ length: 4 }, (_, k) => `<path d="M${360 + k * 25} 262 V318" stroke="${line}" stroke-opacity=".3" stroke-width="3"/>`).join("")}</g>`;
        })
        .join("");
    }
  }
}

function svg(d: DemoProduct): string {
  const fill = d.colors[0]!.hex;
  const line = luminance(fill) < 0.25 ? shade(fill, 0.4) : shade(fill, -0.45);
  const hangs = ["t-shirts", "shirts", "polos", "outerwear"].includes(d.category);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4ede2"/><stop offset="1" stop-color="#e3d6c2"/></linearGradient>
    <linearGradient id="light" x1="0" y1="0" x2="1" y2="0.2"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
    <radialGradient id="shadow"><stop offset="0" stop-color="#5b4630" stop-opacity=".28"/><stop offset="1" stop-color="#5b4630" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="400" cy="940" rx="300" ry="34" fill="url(#shadow)"/>
  ${hangs ? HANGER : ""}
  ${body(d, fill, line)}
</svg>`;
}

async function main() {
mkdirSync(OUT, { recursive: true });
await Promise.all(
  DEMO_PRODUCTS.map((d) =>
    sharp(Buffer.from(svg(d)))
      .webp({ quality: 80 })
      .toFile(path.join(OUT, `${d.slug}.webp`)),
  ),
);
console.log(`Wrote ${DEMO_PRODUCTS.length} illustrations to ${path.relative(process.cwd(), OUT)}`);
}

void main();
