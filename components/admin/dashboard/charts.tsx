"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatBDT as formatMoney } from "@/lib/money";

/*
 * Dashboard charts: plain SVG, no chart library.
 * Marks follow the admin dataviz spec: 2px lines, ~10% area wash, hairline solid grid,
 * 4px rounded bar ends, text in text tokens (never the series colour), a hover/focus
 * readout on every plotted chart and a table view so no value is hover-only.
 * Series colours are validated (scripts/validate_palette.js): --viz-1 #b06f1c, --viz-2 #2a78d6.
 */

export type TrendPoint = { d: string; value: number };

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
const fmtLongDay = (d: string) => longDayFmt.format(new Date(`${d}T00:00:00Z`));

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en");

/** Clean axis ticks: 0 and 3–4 round steps up to at least max. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function tickLabel(v: number, maxTick: number) {
  return maxTick >= 10000 ? compact.format(v) : full.format(v);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Single-series trend over days: area (default) or columns. Crosshair + tooltip on hover
 * and keyboard (arrow keys), plus a collapsible table view.
 */
export function TrendChart({
  points,
  kind = "area",
  label,
  unit,
  axisDivisor = 1,
  format,
  height = 240,
}: {
  points: TrendPoint[];
  kind?: "area" | "column";
  label: string;
  /** Axis unit note shown above the plot, e.g. "৳". */
  unit?: string;
  /** Divide values for the axis (money arrives in poisha → 100). */
  axisDivisor?: number;
  /** Value format for the tooltip and table (functions cannot cross to a client component). */
  format: "money" | "orders";
  height?: number;
}) {
  const formatValue = format === "money" ? formatMoney : (v: number) => `${full.format(v)} order${v === 1 ? "" : "s"}`;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, "");
  const pad = { top: 12, right: 12, bottom: 26, left: 44 };
  const w = Math.max(width, 280);
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = points.map((p) => p.value / axisDivisor);
  const ticks = niceTicks(Math.max(0, ...values));
  const top = ticks[ticks.length - 1] || 1;
  const n = points.length;
  const band = n > 0 ? innerW / n : innerW;
  const x = (i: number) => (kind === "column" ? pad.left + band * i + band / 2 : pad.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1)));
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const allZero = values.every((v) => v === 0);

  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : "";
  const barW = Math.max(2, Math.min(24, band - 2));
  const labelIdx = n <= 1 ? [0] : Array.from(new Set([0, Math.floor((n - 1) / 2), n - 1]));
  const peak = values.length ? values.indexOf(Math.max(...values)) : -1;

  function pick(clientX: number, rect: DOMRect) {
    const px = clientX - rect.left;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    setActive(best);
  }

  const a = active != null ? points[active] : null;

  return (
    <div className="dash-viz min-w-0">
      <div
        ref={wrapRef}
        className="relative w-full min-w-0 overflow-hidden outline-none"
        tabIndex={0}
        role="group"
        aria-label={`${label}. Use left and right arrow keys to read each day.`}
        onKeyDown={(e) => {
          if (!n) return;
          if (e.key === "ArrowRight") setActive((i) => Math.min(n - 1, (i ?? -1) + 1));
          else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? n) - 1));
          else return;
          e.preventDefault();
        }}
        onBlur={() => setActive(null)}
      >
        {unit ? <p className="absolute left-0 top-0 text-[11px] text-muted">{unit}</p> : null}
        {width > 0 ? (
          <svg
            width={w}
            height={height}
            className="block touch-none"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setActive(null)}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--viz-1)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--viz-1)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {tickLabel(t, top)}
                </text>
              </g>
            ))}
            {labelIdx.map((i) =>
              points[i] ? (
                <text
                  key={i}
                  x={x(i)}
                  y={height - 6}
                  textAnchor={labelIdx.length > 1 && i === 0 ? "start" : labelIdx.length > 1 && i === n - 1 ? "end" : "middle"}
                  className="fill-muted text-[11px]"
                >
                  {fmtDay(points[i].d)}
                </text>
              ) : null,
            )}
            {kind === "area" ? (
              <>
                <path d={area} fill={`url(#${gradientId})`} />
                <path d={line} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {!allZero && peak >= 0 && active == null ? (
                  <circle cx={x(peak)} cy={y(values[peak])} r={4} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} />
                ) : null}
              </>
            ) : (
              values.map((v, i) => {
                const h = Math.max(0, y(0) - y(v));
                const bx = x(i) - barW / 2;
                const r = Math.min(4, h, barW / 2);
                const by = y(0) - h;
                return h > 0 ? (
                  <path
                    key={points[i].d}
                    d={`M${bx},${y(0)}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + barW - r}Q${bx + barW},${by} ${bx + barW},${by + r}V${y(0)}Z`}
                    fill="var(--viz-1)"
                    opacity={active == null || active === i ? 1 : 0.55}
                  />
                ) : null;
              })
            )}
            {a && active != null ? (
              <g>
                <line x1={x(active)} x2={x(active)} y1={pad.top} y2={y(0)} stroke="var(--viz-crosshair)" strokeWidth={1} shapeRendering="crispEdges" />
                {kind === "area" ? (
                  <circle cx={x(active)} cy={y(values[active])} r={4.5} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} />
                ) : null}
              </g>
            ) : null}
          </svg>
        ) : (
          <div style={{ height }} />
        )}
        {a && active != null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 min-w-32 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(x(active) - 64, 0), w - 140) }}
          >
            <p className="text-sm font-semibold text-espresso">{formatValue(a.value)}</p>
            <p className="flex items-center gap-1.5 text-muted">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--viz-1)" }} aria-hidden="true" />
              {fmtLongDay(a.d)}
            </p>
          </div>
        ) : null}
      </div>
      {allZero ? <p className="mt-1 text-xs text-muted">No {label.toLowerCase()} in this period yet.</p> : null}
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none hover:text-espresso">Show as table</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded border border-line">
          <table className="w-full text-left tabular-nums">
            <thead className="sticky top-0 bg-mist">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day</th>
                <th className="px-3 py-1.5 text-right font-medium">{label}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.d} className="border-t border-line/60">
                  <td className="px-3 py-1">{fmtLongDay(p.d)}</td>
                  <td className="px-3 py-1 text-right text-charcoal">{formatValue(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

