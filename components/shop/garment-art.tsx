/**
 * Flat garment illustrations for the rail section, used until staff upload real
 * photography. One silhouette per category, drawn front and back, filled with
 * the product's own colour so the rail reads like the real stock.
 */

export type GarmentKind = "tee" | "shirt" | "polo" | "hoodie" | "jacket" | "coat" | "trouser";

export function garmentKind(categorySlug: string | null, title: string): GarmentKind {
  const t = title.toLowerCase();
  if (categorySlug === "pants") return "trouser";
  if (categorySlug === "polos") return t.includes("long sleeve") ? "shirt" : "polo";
  if (categorySlug === "shirts") return "shirt";
  if (categorySlug === "outerwear") {
    if (t.includes("hood")) return "hoodie";
    if (t.includes("coat") || t.includes("trench")) return "coat";
    return "jacket";
  }
  return "tee";
}

function safeHex(hex: string | null | undefined) {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#c9b79c";
}

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

// Body outlines in a 200 x 240 box; the hanger's shoulder line sits at y ≈ 20.
const BODY: Record<GarmentKind, string> = {
  tee: "M72 20 Q100 34 128 20 L168 34 L192 82 L162 94 L154 80 L156 214 Q100 220 44 214 L46 80 L38 94 L8 82 L32 34 Z",
  polo: "M74 20 Q100 30 126 20 L168 34 L192 82 L162 94 L154 80 L156 214 Q100 220 44 214 L46 80 L38 94 L8 82 L32 34 Z",
  shirt: "M74 18 Q100 28 126 18 L164 30 Q178 60 188 196 L166 200 L156 92 L158 218 Q100 224 42 218 L44 92 L34 200 L12 196 Q22 60 36 30 Z",
  hoodie: "M66 22 Q100 40 134 22 L166 32 Q180 62 188 200 L166 204 L158 96 L158 206 L150 220 Q100 226 50 220 L42 206 L42 96 L34 204 L12 200 Q20 62 34 32 Z",
  jacket: "M70 20 Q100 32 130 20 L166 32 Q180 62 188 196 L166 200 L158 96 L158 204 L150 214 Q100 220 50 214 L42 204 L42 96 L34 200 L12 196 Q20 62 34 32 Z",
  coat: "M72 18 Q100 30 128 18 L164 30 Q178 60 186 200 L166 204 L158 100 L168 236 Q100 242 32 236 L42 100 L34 204 L14 200 Q22 60 36 30 Z",
  trouser: "M52 22 L148 22 L160 232 L114 232 L100 84 L86 232 L40 232 Z",
};

function FrontDetails({ kind, ink }: { kind: GarmentKind; ink: string }) {
  const p = { fill: "none", stroke: ink, strokeWidth: 2, strokeLinecap: "round" as const };
  switch (kind) {
    case "tee":
      return <path d="M76 22 Q100 44 124 22" {...p} strokeWidth={3} />;
    case "polo":
      return (
        <>
          <path d="M74 20 L92 46 L100 30 L108 46 L126 20" {...p} />
          <path d="M100 30 L100 62" {...p} />
          <circle cx="100" cy="42" r="1.8" fill={ink} />
          <circle cx="100" cy="54" r="1.8" fill={ink} />
        </>
      );
    case "shirt":
      return (
        <>
          <path d="M74 18 L90 44 L100 26 L110 44 L126 18" {...p} />
          <path d="M100 26 L100 218" {...p} />
          {[56, 88, 120, 152, 184].map((y) => (
            <circle key={y} cx="104" cy={y} r="1.8" fill={ink} />
          ))}
          <path d="M66 70 L88 70 L88 92 Q77 96 66 92 Z" {...p} strokeWidth={1.5} />
        </>
      );
    case "hoodie":
      return (
        <>
          <path d="M66 22 Q72 52 100 58 Q128 52 134 22" {...p} strokeWidth={3} />
          <path d="M94 58 L92 92 M106 58 L108 92" {...p} strokeWidth={1.5} />
          <path d="M64 150 L136 150 L144 190 L56 190 Z" {...p} strokeWidth={1.5} />
          <path d="M42 206 L158 206" {...p} strokeWidth={1.5} />
        </>
      );
    case "jacket":
      return (
        <>
          <path d="M70 20 Q100 40 130 20" {...p} strokeWidth={3} />
          <path d="M100 30 L100 214" {...p} />
          <path d="M60 140 L76 176 M140 140 L124 176" {...p} strokeWidth={1.5} />
          <path d="M42 204 L158 204" {...p} strokeWidth={1.5} />
        </>
      );
    case "coat":
      return (
        <>
          <path d="M72 18 L86 64 L100 40 L114 64 L128 18" {...p} />
          <path d="M100 40 L104 236" {...p} />
          <path d="M40 128 L162 128" {...p} strokeWidth={5} />
          <circle cx="114" cy="96" r="2.2" fill={ink} />
          <circle cx="114" cy="160" r="2.2" fill={ink} />
        </>
      );
    case "trouser":
      return (
        <>
          <path d="M52 36 L148 36" {...p} />
          <path d="M100 36 L100 84 M100 40 Q112 64 104 82" {...p} strokeWidth={1.5} />
          <path d="M56 40 Q66 58 82 40 M144 40 Q134 58 118 40" {...p} strokeWidth={1.5} />
        </>
      );
  }
}

function BackDetails({ kind, ink, brand }: { kind: GarmentKind; ink: string; brand: string }) {
  const p = { fill: "none", stroke: ink, strokeWidth: 2, strokeLinecap: "round" as const };
  const mark = (y: number) => (
    <text x="100" y={y} textAnchor="middle" fill={ink} fontSize="15" fontWeight="700" letterSpacing="3" fontFamily="ui-sans-serif, system-ui, sans-serif">
      {brand.toUpperCase().slice(0, 12)}
    </text>
  );
  switch (kind) {
    case "trouser":
      return (
        <>
          <path d="M52 36 L148 36" {...p} />
          <path d="M100 36 L100 84" {...p} strokeWidth={1.5} />
          <path d="M62 54 L90 54 L90 80 Q76 84 62 80 Z M110 54 L138 54 L138 80 Q124 84 110 80 Z" {...p} strokeWidth={1.5} />
        </>
      );
    case "hoodie":
      return (
        <>
          <path d="M66 22 Q100 10 134 22 Q130 76 100 84 Q70 76 66 22 Z" {...p} strokeWidth={1.5} />
          {mark(124)}
          <path d="M42 206 L158 206" {...p} strokeWidth={1.5} />
        </>
      );
    case "shirt":
    case "coat":
      return (
        <>
          <path d="M70 46 Q100 56 130 46" {...p} strokeWidth={1.5} />
          {mark(104)}
          {kind === "coat" ? <path d="M40 128 L162 128" {...p} strokeWidth={5} /> : null}
        </>
      );
    default:
      return (
        <>
          <path d="M76 22 Q100 30 124 22" {...p} strokeWidth={3} />
          {mark(96)}
        </>
      );
  }
}

export function GarmentArt({
  kind,
  hex,
  side,
  brand,
  className = "",
}: {
  kind: GarmentKind;
  hex: string | null | undefined;
  side: "front" | "back";
  brand: string;
  className?: string;
}) {
  const fill = safeHex(hex);
  const light = isLight(fill);
  const ink = light ? "rgba(43,29,20,0.28)" : "rgba(255,255,255,0.32)";
  const gid = `g-${kind}-${fill.slice(1)}-${side}`;
  return (
    <svg viewBox="0 0 200 244" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={light ? 0.35 : 0.14} />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <path d={BODY[kind]} fill={fill} stroke="rgba(43,29,20,0.22)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={BODY[kind]} fill={`url(#${gid})`} />
      {side === "front" ? <FrontDetails kind={kind} ink={ink} /> : <BackDetails kind={kind} ink={ink} brand={brand} />}
    </svg>
  );
}
