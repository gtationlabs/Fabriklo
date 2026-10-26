import Link from "next/link";
import { parseInline, type Block } from "@/lib/cms/blocks";

/** Renders allow-listed blocks as React elements. Text is always escaped by React. */
export function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((seg, i) =>
        seg.kind === "bold" ? (
          <strong key={i}>{seg.text}</strong>
        ) : seg.kind === "link" ? (
          <Link key={i} href={seg.href} className="underline underline-offset-4">
            {seg.text}
          </Link>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-6 text-[1.05rem] leading-relaxed text-charcoal">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return b.level === 2 ? (
              <h2 key={i} className="pt-4 font-display text-2xl font-semibold text-espresso">{b.text}</h2>
            ) : (
              <h3 key={i} className="pt-2 text-lg font-semibold text-espresso">{b.text}</h3>
            );
          case "paragraph":
            return <p key={i}><InlineText text={b.text} /></p>;
          case "list":
            return b.style === "number" ? (
              <ol key={i} className="list-decimal space-y-1 pl-6">{b.items.map((it, n) => <li key={n}><InlineText text={it} /></li>)}</ol>
            ) : (
              <ul key={i} className="list-disc space-y-1 pl-6">{b.items.map((it, n) => <li key={n}><InlineText text={it} /></li>)}</ul>
            );
          case "faq":
            return (
              <dl key={i} className="divide-y divide-line rounded border border-line">
                {b.items.map((it, n) => (
                  <div key={n} className="p-4">
                    <dt className="font-semibold text-espresso">{it.q}</dt>
                    <dd className="mt-1 text-muted"><InlineText text={it.a} /></dd>
                  </div>
                ))}
              </dl>
            );
          case "callout":
            return (
              <p
                key={i}
                role={b.tone === "warning" ? "note" : undefined}
                className={`rounded border p-4 text-sm ${b.tone === "warning" ? "border-bronze/50 bg-bronze/10 text-bronze-strong" : "border-line bg-cream"}`}
              >
                <InlineText text={b.text} />
              </p>
            );
          case "cta":
            return (
              <p key={i}>
                <Link href={b.href} className="inline-block rounded bg-espresso px-5 py-2.5 font-medium text-cream hover:bg-charcoal">{b.label}</Link>
              </p>
            );
          case "image":
            return (
              <figure key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local asset */}
                <img src={b.path} alt={b.alt} loading="lazy" className="w-full rounded object-cover" />
                {b.caption ? <figcaption className="mt-2 text-sm text-muted">{b.caption}</figcaption> : null}
              </figure>
            );
        }
      })}
    </div>
  );
}
