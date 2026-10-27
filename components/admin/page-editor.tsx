"use client";

import { useActionState, useState } from "react";
import { publishPage, rollbackPage, savePageDraft, unpublishPage, type PageActionState } from "@/app/admin/(console)/content/pages/actions";
import { FormMessage, inputCls } from "@/components/admin/form-bits";
import { Blocks } from "@/components/cms/blocks";
import { BLOCK_TYPES, blocksSchema, type Block } from "@/lib/cms/blocks";

const idle: PageActionState = { ok: false, message: null };
const btn = "rounded bg-espresso px-3 py-2 text-sm text-cream hover:bg-charcoal disabled:opacity-60";
const small = "rounded border border-line px-2 py-1 text-xs disabled:opacity-40";
const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

type PageMeta = { id: string; slug: string; title: string; page_kind: string; seo_title: string | null; seo_description: string | null; status: string };

function blank(type: Block["type"]): Block {
  switch (type) {
    case "heading": return { type, level: 2, text: "New heading" };
    case "paragraph": return { type, text: "New paragraph. Use **bold** and [links](/shop)." };
    case "list": return { type, style: "bullet", items: ["First item"] };
    case "faq": return { type, items: [{ q: "Question?", a: "Answer." }] };
    case "callout": return { type, tone: "info", text: "Something worth noting." };
    case "cta": return { type, label: "Start shopping", href: "/shop" };
    case "image": return { type, path: "/assets/store/store-01.webp", alt: "Describe the image", caption: "" };
  }
}

export function PageEditor({ page, blocks: initial, canPublish }: { page: PageMeta; blocks: Block[]; canPublish: boolean }) {
  const [state, action, pending] = useActionState(savePageDraft, idle);
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (state.values?.blocks) {
      try { const p = blocksSchema.safeParse(JSON.parse(state.values.blocks)); if (p.success) return p.data; } catch { /* fall through */ }
    }
    return initial;
  });
  const [preview, setPreview] = useState(false);
  const v = state.values ?? { slug: page.slug, title: page.title, page_kind: page.page_kind, seo_title: page.seo_title ?? "", seo_description: page.seo_description ?? "" };

  const update = (i: number, b: Block) => setBlocks((bs) => bs.map((x, n) => (n === i ? b : x)));
  const move = (i: number, d: -1 | 1) =>
    setBlocks((bs) => {
      const j = i + d;
      if (j < 0 || j >= bs.length) return bs;
      const c = [...bs];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    });
  const remove = (i: number) => setBlocks((bs) => bs.filter((_, n) => n !== i));

  return (
    <form action={action} className="space-y-8" aria-label="Page editor">
      <input type="hidden" name="id" value={page.id} />
      <input type="hidden" name="blocks" value={JSON.stringify(blocks)} />
      <div className="grid gap-3 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
        <label className="text-xs font-medium">Title<input name="title" defaultValue={v.title} maxLength={140} required className={inputCls} /></label>
        <label className="text-xs font-medium">Address (/slug)<input name="slug" defaultValue={v.slug} maxLength={80} required className={inputCls} /></label>
        <label className="text-xs font-medium">Kind
          <select name="page_kind" defaultValue={v.page_kind} className={inputCls}>
            <option value="page">Page</option><option value="help">Help</option><option value="legal">Legal (shows last-updated date)</option>
          </select>
        </label>
        <label className="text-xs font-medium">SEO title (optional)<input name="seo_title" defaultValue={v.seo_title} maxLength={70} className={inputCls} /></label>
        <label className="text-xs font-medium sm:col-span-2">SEO description (optional)<input name="seo_description" defaultValue={v.seo_description} maxLength={170} className={inputCls} /></label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Add block:</span>
        {BLOCK_TYPES.map((t) => (
          <button key={t} type="button" onClick={() => setBlocks((bs) => [...bs, blank(t)])} className={small}>{t}</button>
        ))}
        <button type="button" onClick={() => setPreview((p) => !p)} className={`${small} ml-auto`} aria-pressed={preview}>
          {preview ? "Back to editing" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div className="rounded-lg border border-line bg-paper p-6"><Blocks blocks={blocks} /></div>
      ) : (
        <ol className="space-y-3">
          {blocks.map((b, i) => (
            <li key={i} className="rounded-lg border border-line bg-white p-4" data-testid="block">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">{i + 1}. {b.type}</span>
                <span className="flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={small}>Up</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className={small}>Down</button>
                  <button type="button" onClick={() => remove(i)} className={`${small} text-danger`}>Remove</button>
                </span>
              </div>
              <BlockFields block={b} onChange={(nb) => update(i, nb)} index={i} />
            </li>
          ))}
          {blocks.length === 0 ? <li className="rounded border border-dashed border-line p-6 text-center text-sm text-muted">No blocks yet. Add one above.</li> : null}
        </ol>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>{pending ? "Saving…" : "Save draft"}</button>
        <FormMessage state={state} />
      </div>
      {!canPublish ? <p className="text-xs text-muted">Someone with publish permission makes drafts live.</p> : null}
    </form>
  );
}

function BlockFields({ block: b, onChange, index }: { block: Block; onChange: (b: Block) => void; index: number }) {
  const id = (k: string) => `b${index}-${k}`;
  switch (b.type) {
    case "heading":
      return (
        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
          <label htmlFor={id("level")} className="text-xs">Level
            <select id={id("level")} value={b.level} onChange={(e) => onChange({ ...b, level: Number(e.target.value) as 2 | 3 })} className={inputCls}><option value={2}>H2</option><option value={3}>H3</option></select>
          </label>
          <label htmlFor={id("text")} className="text-xs">Text<input id={id("text")} value={b.text} maxLength={120} onChange={(e) => onChange({ ...b, text: e.target.value })} className={inputCls} /></label>
        </div>
      );
    case "paragraph":
      return <label htmlFor={id("text")} className="text-xs">Text<textarea id={id("text")} value={b.text} rows={3} maxLength={2000} onChange={(e) => onChange({ ...b, text: e.target.value })} className={inputCls} /></label>;
    case "callout":
      return (
        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
          <label htmlFor={id("tone")} className="text-xs">Tone
            <select id={id("tone")} value={b.tone} onChange={(e) => onChange({ ...b, tone: e.target.value as "info" | "warning" })} className={inputCls}><option value="info">Info</option><option value="warning">Warning</option></select>
          </label>
          <label htmlFor={id("text")} className="text-xs">Text<input id={id("text")} value={b.text} maxLength={500} onChange={(e) => onChange({ ...b, text: e.target.value })} className={inputCls} /></label>
        </div>
      );
    case "list":
      return (
        <div className="space-y-2">
          <label htmlFor={id("style")} className="text-xs">Style
            <select id={id("style")} value={b.style} onChange={(e) => onChange({ ...b, style: e.target.value as "bullet" | "number" })} className={inputCls}><option value="bullet">Bullets</option><option value="number">Numbered</option></select>
          </label>
          <label htmlFor={id("items")} className="text-xs">Items (one per line)
            <textarea id={id("items")} value={b.items.join("\n")} rows={4} onChange={(e) => onChange({ ...b, items: e.target.value.split("\n") })} className={inputCls} />
          </label>
        </div>
      );
    case "faq":
      return (
        <div className="space-y-2">
          {b.items.map((it, n) => (
            <div key={n} className="grid gap-2 rounded border border-line p-2 sm:grid-cols-2">
              <label className="text-xs">Question<input value={it.q} maxLength={200} onChange={(e) => onChange({ ...b, items: b.items.map((x, m) => (m === n ? { ...x, q: e.target.value } : x)) })} className={inputCls} /></label>
              <label className="text-xs">Answer<input value={it.a} maxLength={1000} onChange={(e) => onChange({ ...b, items: b.items.map((x, m) => (m === n ? { ...x, a: e.target.value } : x)) })} className={inputCls} /></label>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ ...b, items: [...b.items, { q: "", a: "" }] })} className={small}>Add question</button>
        </div>
      );
    case "cta":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <label htmlFor={id("label")} className="text-xs">Button label<input id={id("label")} value={b.label} maxLength={40} onChange={(e) => onChange({ ...b, label: e.target.value })} className={inputCls} /></label>
          <label htmlFor={id("href")} className="text-xs">Internal link<input id={id("href")} value={b.href} maxLength={200} onChange={(e) => onChange({ ...b, href: e.target.value })} className={inputCls} /></label>
        </div>
      );
    case "image":
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          <label htmlFor={id("path")} className="text-xs">Asset path<input id={id("path")} value={b.path} onChange={(e) => onChange({ ...b, path: e.target.value })} className={inputCls} /></label>
          <label htmlFor={id("alt")} className="text-xs">Alt text<input id={id("alt")} value={b.alt} maxLength={300} onChange={(e) => onChange({ ...b, alt: e.target.value })} className={inputCls} /></label>
          <label htmlFor={id("cap")} className="text-xs">Caption<input id={id("cap")} value={b.caption ?? ""} maxLength={200} onChange={(e) => onChange({ ...b, caption: e.target.value })} className={inputCls} /></label>
        </div>
      );
  }
}

export function PagePublishPanel({ page, versions, liveId, canPublish }: {
  page: PageMeta;
  versions: { id: string; version: number; note: string | null; created_at: string }[];
  liveId: string | null;
  canPublish: boolean;
}) {
  const [pub, pubAction, pubPending] = useActionState(publishPage, idle);
  const [rb, rbAction, rbPending] = useActionState(rollbackPage, idle);
  const [un, unAction, unPending] = useActionState(unpublishPage, idle);
  return (
    <aside className="space-y-4">
      <div className="rounded-lg border border-bronze/40 bg-cream p-4">
        <p className="text-sm">
          Status: <span className="font-medium">{page.status}</span>
          {page.status === "published" ? <> · <a href={`/${page.slug}`} target="_blank" rel="noreferrer" className="underline">view live ↗</a></> : null}
        </p>
        {canPublish ? (
          <>
            <form action={pubAction} key={String(pub.ok)} className="mt-3 space-y-2" aria-label="Publish page">
              <input type="hidden" name="id" value={page.id} />
              <label className="text-xs font-medium">What changed? (optional)<input name="note" defaultValue={pub.values?.note ?? ""} maxLength={200} className={inputCls} /></label>
              <button type="submit" disabled={pubPending} className="rounded bg-bronze-strong px-4 py-2 text-sm font-medium text-cream disabled:opacity-60">{pubPending ? "Publishing…" : "Publish draft"}</button>
              <FormMessage state={pub} />
            </form>
            {page.status === "published" ? (
              <form action={unAction} className="mt-3">
                <input type="hidden" name="id" value={page.id} />
                <button type="submit" disabled={unPending} className="text-xs text-danger underline">Take page offline</button>
                <FormMessage state={un} />
              </form>
            ) : null}
          </>
        ) : null}
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-espresso">Published versions</h2>
        <FormMessage state={rb} />
        <ul className="divide-y divide-line rounded border border-line bg-white text-sm" data-testid="page-versions">
          {versions.length === 0 ? <li className="px-3 py-2 text-muted">Not published yet.</li> : null}
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="font-medium">v{v.version}</span>
                {v.id === liveId ? <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Live</span> : null}
                <span className="ml-2 text-muted">{dateFmt.format(new Date(v.created_at))}{v.note ? ` · ${v.note}` : ""}</span>
              </span>
              {canPublish && v.id !== liveId ? (
                <form action={rbAction}>
                  <input type="hidden" name="id" value={page.id} />
                  <input type="hidden" name="versionId" value={v.id} />
                  <button type="submit" disabled={rbPending} className={small}>Roll back to v{v.version}</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
