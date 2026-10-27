"use client";

import { useActionState, useMemo, useState } from "react";
import { publishTheme, rollbackTheme, saveThemeDraft, type ThemeActionState } from "@/app/admin/(console)/content/theme/actions";
import { FormMessage, inputCls } from "@/components/admin/form-bits";
import type { ThemeVersion } from "@/lib/theme/service";
import {
  BODY_FONTS,
  COLOR_KEYS,
  COLOR_LABELS,
  DISPLAY_FONTS,
  RADII,
  contrastChecks,
  normaliseHex,
  themeStyle,
  themeTokensSchema,
  type ThemeTokens,
} from "@/lib/theme/tokens";

const idle: ThemeActionState = { ok: false, message: null };
const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Colour / font / radius editor with a live, scoped preview and WCAG contrast checks. */
export function ThemeEditor({ draft }: { draft: ThemeTokens }) {
  const [state, action, pending] = useActionState(saveThemeDraft, idle);
  const [tokens, setTokens] = useState<ThemeTokens>(draft);
  const valid = useMemo(() => themeTokensSchema.safeParse(tokens), [tokens]);
  const checks = useMemo(() => (valid.success ? contrastChecks(valid.data) : []), [valid]);
  const failing = checks.filter((c) => !c.ok);

  const setColor = (k: (typeof COLOR_KEYS)[number], v: string) => setTokens((t) => ({ ...t, colors: { ...t.colors, [k]: normaliseHex(v) } }));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form action={action} aria-label="Theme draft" className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="font-semibold text-espresso">Colours</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {COLOR_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-3 rounded border border-line bg-white p-2 text-sm">
                <input
                  type="color"
                  aria-label={`${COLOR_LABELS[k].label} picker`}
                  value={/^#[0-9a-f]{6}$/.test(tokens.colors[k]) ? tokens.colors[k] : "#000000"}
                  onChange={(e) => setColor(k, e.target.value)}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded border border-line"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{COLOR_LABELS[k].label}</span>
                  <span className="block text-xs text-muted">{COLOR_LABELS[k].hint}</span>
                </span>
                <input
                  name={`color_${k}`}
                  aria-label={COLOR_LABELS[k].label}
                  value={tokens.colors[k]}
                  onChange={(e) => setColor(k, e.target.value)}
                  pattern="#[0-9a-fA-F]{6}"
                  maxLength={7}
                  className="w-24 rounded border border-line px-2 py-1 font-mono text-xs"
                />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 font-semibold text-espresso">Type and shape</legend>
          <label className="text-sm">
            <span className="block font-medium">Heading font</span>
            <select name="font_display" value={tokens.fonts.display} onChange={(e) => setTokens((t) => ({ ...t, fonts: { ...t.fonts, display: e.target.value as ThemeTokens["fonts"]["display"] } }))} className={inputCls}>
              {Object.entries(DISPLAY_FONTS).map(([k, f]) => (
                <option key={k} value={k}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium">Body font</span>
            <select name="font_body" value={tokens.fonts.body} onChange={(e) => setTokens((t) => ({ ...t, fonts: { ...t.fonts, body: e.target.value as ThemeTokens["fonts"]["body"] } }))} className={inputCls}>
              {Object.entries(BODY_FONTS).map(([k, f]) => (
                <option key={k} value={k}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium">Corners</span>
            <select name="radius" value={tokens.radius} onChange={(e) => setTokens((t) => ({ ...t, radius: e.target.value as ThemeTokens["radius"] }))} className={inputCls}>
              {Object.entries(RADII).map(([k, r]) => (
                <option key={k} value={k}>{r.label}</option>
              ))}
            </select>
          </label>
        </fieldset>

        <section aria-labelledby="contrast-h" className="rounded border border-line bg-white p-4 text-sm" data-testid="contrast-checks">
          <h3 id="contrast-h" className="font-medium text-espresso">Readability (WCAG contrast)</h3>
          {failing.length ? (
            <ul className="mt-2 space-y-1 text-danger">
              {failing.map((c) => (
                <li key={c.pair}>{c.pair}: {c.ratio}:1, needs at least {c.minimum}:1</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-success">All text pairs meet WCAG AA.</p>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending || !valid.success} className="rounded bg-espresso px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">
            {pending ? "Saving…" : "Save draft"}
          </button>
          <button type="button" onClick={() => setTokens(draft)} className="rounded border border-line px-4 py-2 text-sm">Reset to saved draft</button>
          {!valid.success ? <span className="text-xs text-danger">Fix the highlighted colour values first.</span> : null}
        </div>
        <FormMessage state={state} />
      </form>

      <ThemePreview tokens={valid.success ? valid.data : draft} />
    </div>
  );
}

/** Scoped preview: the same CSS variables the storefront uses, applied to a sample of its components. */
export function ThemePreview({ tokens }: { tokens: ThemeTokens }) {
  return (
    <div aria-label="Theme preview" role="region" className="lg:sticky lg:top-6 lg:self-start">
      <p className="mb-2 text-xs text-muted">Live preview of the draft (not the real store).</p>
      <div style={themeStyle(tokens)} data-testid="theme-preview" className="overflow-hidden rounded-lg border border-line bg-paper text-charcoal shadow-sm">
        <header className="flex items-center justify-between border-b border-line bg-paper px-5 py-3">
          <span className="font-display text-xl font-semibold text-espresso">Store name</span>
          <nav className="flex gap-4 text-sm"><span>Shop</span><span>Men</span><span>Women</span></nav>
        </header>
        <div className="space-y-5 p-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-bronze">New arrivals</p>
            <h2 className="font-display text-3xl font-semibold text-espresso">Headline in the display font</h2>
            <p className="mt-1 text-sm text-muted">Secondary text uses the muted colour; body text uses the body font.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {["Linen shirt", "Chino trousers"].map((n) => (
              <div key={n} className="rounded-lg border border-line bg-cream p-3">
                <div className="mb-2 aspect-[4/5] rounded-md bg-sand" />
                <p className="text-sm font-medium">{n}</p>
                <p className="text-sm text-muted">৳ 2,490</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-md bg-bronze-strong px-4 py-2 text-sm font-medium text-cream">Add to bag</span>
            <span className="rounded-md border border-espresso px-4 py-2 text-sm font-medium text-espresso">Learn more</span>
            <span className="rounded-md border border-line px-4 py-2 text-sm">Secondary</span>
          </div>
          <p className="text-sm"><span className="text-danger">Error text</span> · <span className="text-success">Success text</span> · <span className="text-bronze underline">A link</span></p>
        </div>
        <footer className="bg-espresso px-5 py-4 text-sm text-cream">Footer on the dark surface</footer>
      </div>
    </div>
  );
}

export function ThemePublishForm() {
  const [state, action, pending] = useActionState(publishTheme, idle);
  return (
    <form action={action} key={String(state.ok)} aria-label="Publish theme" className="flex flex-wrap items-end gap-2">
      <label className="min-w-56 flex-1 text-xs font-medium">
        What changed? (optional)
        <input name="note" maxLength={200} className={inputCls} />
      </label>
      <button type="submit" disabled={pending} className="rounded bg-bronze-strong px-4 py-2 text-sm font-medium text-cream hover:bg-espresso disabled:opacity-60">
        {pending ? "Publishing…" : "Publish draft theme"}
      </button>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function ThemeVersionList({ versions, liveId, canPublish }: { versions: ThemeVersion[]; liveId: string | null; canPublish: boolean }) {
  const [state, action, pending] = useActionState(rollbackTheme, idle);
  return (
    <div className="space-y-2">
      <FormMessage state={state} />
      {versions.length === 0 ? <p className="text-sm text-muted">Nothing published yet: the store uses the built-in defaults.</p> : null}
      <ul className="divide-y divide-line rounded border border-line bg-white text-sm" data-testid="theme-versions">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <span className="flex items-center gap-2">
              <span className="flex gap-0.5" aria-hidden>
                {(["paper", "espresso", "bronze", "cream"] as const).map((k) => (
                  <span key={k} className="h-4 w-4 rounded-sm border border-line" style={{ background: v.tokens.colors[k] }} />
                ))}
              </span>
              <span className="font-medium">Version {v.version}</span>
              {v.id === liveId ? <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Live</span> : null}
              <span className="text-muted">{dateFmt.format(new Date(v.created_at))}{v.note ? ` · ${v.note}` : ""}</span>
            </span>
            {canPublish && v.id !== liveId ? (
              <form action={action}>
                <input type="hidden" name="versionId" value={v.id} />
                <button type="submit" disabled={pending} className="rounded border border-line px-3 py-1 text-xs">Roll back to version {v.version}</button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
