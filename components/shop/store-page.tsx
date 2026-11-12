import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { href?: string; label: string };

/** Breadcrumb in the catalogue style: underlined links, "/" separators, current page plain. */
export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {crumbs.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden className="text-neutral-400">/</span> : null}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="underline underline-offset-2 hover:no-underline">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-neutral-600">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const WIDTHS = { narrow: "max-w-md", text: "max-w-3xl", default: "max-w-5xl", wide: "max-w-7xl" } as const;

/**
 * Frame for every service page (bag, checkout, account, help, orders): a grey
 * breadcrumb band, a centred uppercase title and the page body on white, in
 * the same near-black / cool-grey palette as the catalogue pages.
 */
export function StorePage({
  title,
  crumbs,
  intro,
  eyebrow,
  width = "default",
  align = "center",
  actions,
  children,
  testId,
}: {
  title: string;
  crumbs?: Crumb[];
  intro?: ReactNode;
  eyebrow?: string;
  width?: keyof typeof WIDTHS;
  align?: "center" | "left";
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const w = WIDTHS[width];
  return (
    <div className="catalog-skin min-h-[60vh] bg-white" data-testid={testId}>
      <div className="border-b border-neutral-200 bg-mist">
        <div className={`mx-auto ${width === "narrow" ? "max-w-5xl" : w} px-4 py-3.5 sm:px-6`}>
          <Breadcrumb crumbs={[{ href: "/", label: "Home" }, ...(crumbs ?? [{ label: title }])]} />
        </div>
      </div>
      <div className={`mx-auto ${w} px-4 pb-20 pt-10 sm:px-6 md:pt-14`}>
        <header className={align === "center" ? "text-center" : "flex flex-wrap items-end justify-between gap-4"}>
          <div>
            {eyebrow ? <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-neutral-500">{eyebrow}</p> : null}
            <h1 className="mt-1 text-[22px] font-medium uppercase tracking-[0.14em] text-ink md:text-[26px]">{title}</h1>
            {intro ? <div className={`mt-3 text-[14px] leading-relaxed text-neutral-600 ${align === "center" ? "mx-auto max-w-xl" : "max-w-xl"}`}>{intro}</div> : null}
          </div>
          {actions}
        </header>
        <div className="mt-10">{children}</div>
      </div>
    </div>
  );
}

/** Bordered white box used for summaries and side panels. */
export function Panel({ title, children, className = "", tone = "white" }: { title?: ReactNode; children: ReactNode; className?: string; tone?: "white" | "mist" }) {
  return (
    <section className={`rounded-[6px] border border-neutral-200 p-5 md:p-6 ${tone === "mist" ? "bg-mist" : "bg-white"} ${className}`}>
      {title ? <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.14em] text-ink">{title}</h2> : null}
      {children}
    </section>
  );
}

export const btnPrimary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[4px] bg-ink px-6 text-[14px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60";
export const btnOutline =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[4px] border border-ink px-6 text-[14px] text-ink transition hover:bg-ink hover:text-white";

/** Empty state: icon, message and a way forward. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-[6px] border border-dashed border-neutral-300 bg-mist px-6 py-12 text-center">
      {icon ? <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-ink">{icon}</div> : null}
      <p className="text-[16px] font-medium text-ink">{title}</p>
      {children ? <div className="mt-2 text-[14px] text-neutral-600">{children}</div> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
