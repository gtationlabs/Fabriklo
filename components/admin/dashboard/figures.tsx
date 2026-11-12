/*
 * Server-rendered dashboard figures (no client JS): sparkline, ranked bars, split bar.
 * Same mark spec as charts.tsx; values are printed, so nothing depends on hover.
 */

/** 12-point trend line for a stat tile: earlier points muted, the latest in the accent. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const pts = values.slice(-12);
  const w = 96;
  const h = 32;
  const max = Math.max(...pts, 0);
  if (pts.length < 2) return null;
  const x = (i: number) => 2 + ((w - 4) * i) / (pts.length - 1);
  const y = (v: number) => (max === 0 ? h - 3 : h - 3 - ((h - 6) * v) / max);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = pts.length - 1;
  const tail = `M${x(last - 1).toFixed(1)},${y(pts[last - 1]).toFixed(1)}L${x(last).toFixed(1)},${y(pts[last]).toFixed(1)}`;
  return (
    <svg width={w} height={h} role="img" aria-label={label} className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke="var(--viz-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <path d={tail} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinecap="round" />
      <circle cx={x(last)} cy={y(pts[last])} r={3.5} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} />
    </svg>
  );
}

/** Ranked horizontal bars with the value at the tip; each row is focusable and lifts on hover. */
export function BarList({
  rows,
  formatValue,
  detail,
  empty,
}: {
  rows: { name: string; value: number; href?: string }[];
  formatValue: (v: number) => string;
  detail?: (row: { name: string; value: number }) => string;
  empty: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <li key={r.name} className="group" tabIndex={0} title={detail ? detail(r) : `${r.name}: ${formatValue(r.value)}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-charcoal">{r.name}</span>
              <span className="shrink-0 font-medium tabular-nums text-espresso">{formatValue(r.value)}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[var(--viz-track)]">
              <div
                className="h-2.5 rounded-full transition-[filter] group-hover:brightness-110 group-focus:brightness-110"
                style={{ width: `${Math.max(pct, 1.5)}%`, background: "var(--viz-1)" }}
              />
            </div>
            {detail ? <p className="sr-only">{detail(r)}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** One whole split into two or more parts (thin 8px bar) with a legend that carries names and values. */
export function SplitBar({
  parts,
  formatValue,
  label,
}: {
  parts: { name: string; value: number; color: string; detail?: string }[];
  formatValue: (v: number) => string;
  label: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div
        className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--viz-track)]"
        role="img"
        aria-label={`${label}: ${parts.map((p) => `${p.name} ${formatValue(p.value)}`).join(", ")}`}
      >
        {total > 0
          ? parts.map((p) =>
              p.value > 0 ? (
                <div key={p.name} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.name}: ${formatValue(p.value)}`} />
              ) : null,
            )
          : null}
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-charcoal">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden="true" />
              {p.name}
            </span>
            <span className="tabular-nums text-espresso">
              <span className="font-medium">{formatValue(p.value)}</span>
              <span className="ml-2 text-xs text-muted">{total > 0 ? `${Math.round((p.value / total) * 100)}%` : "0%"}</span>
              {p.detail ? <span className="ml-2 text-xs text-muted">{p.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
