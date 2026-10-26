/**
 * Placeholder artwork for products without photography. Clearly a placeholder
 * (no fake product photos): a tonal panel in the garment's colour with its name.
 */
export function ProductArt({
  title,
  hex,
  className = "",
  size = "card",
}: {
  title: string;
  hex: string | null | undefined;
  className?: string;
  size?: "card" | "hero";
}) {
  const base = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#c9b79c";
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div
      role="img"
      aria-label={`Placeholder image for ${title}`}
      className={`relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden bg-sand ${className}`}
      style={{ backgroundImage: `linear-gradient(160deg, ${base}33 0%, ${base}88 55%, ${base} 100%)` }}
    >
      <span
        aria-hidden
        className={`font-display font-semibold text-white/85 drop-shadow ${size === "hero" ? "text-8xl" : "text-5xl"}`}
      >
        {initials}
      </span>
      <span aria-hidden className="absolute bottom-2 right-2 text-[10px] uppercase tracking-widest text-white/80">
        Photo coming soon
      </span>
    </div>
  );
}
