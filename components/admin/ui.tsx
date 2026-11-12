import Link from "next/link";

export const fieldCls =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-charcoal outline-none focus:border-espresso focus:ring-2 focus:ring-espresso/10";
export const labelCls = "block text-[11px] font-semibold uppercase tracking-wider text-charcoal/80";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-espresso">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, description, icon, children, className = "", id }: { title?: string; description?: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-label={title} className={`rounded-xl border border-line bg-white ${className}`}>
      {title ? (
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          {icon ? <span className="grid size-9 place-items-center rounded-lg bg-cream text-espresso">{icon}</span> : null}
          <div>
            <h2 className="font-semibold text-espresso">{title}</h2>
            {description ? <p className="text-xs text-muted">{description}</p> : null}
          </div>
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function TextField({ label, name, defaultValue, hint, className = "", ...rest }: { label: string; name: string; defaultValue?: string | number | null; hint?: string; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "name">) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className={labelCls}>{label}</span>
      <input name={name} defaultValue={defaultValue ?? ""} className={fieldCls} {...rest} />
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function TextArea({ label, name, defaultValue, hint, className = "", rows = 3, ...rest }: { label: string; name: string; defaultValue?: string | null; hint?: string; className?: string; rows?: number } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "defaultValue" | "name">) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className={labelCls}>{label}</span>
      <textarea name={name} defaultValue={defaultValue ?? ""} rows={rows} className={fieldCls} {...rest} />
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function SelectField({ label, name, defaultValue, options, hint, className = "" }: { label: string; name: string; defaultValue?: string | null; options: { value: string; label: string }[]; hint?: string; className?: string }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className={labelCls}>{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className={fieldCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

/** Checkbox styled as a switch row, like the settings screenshots. */
export function Toggle({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-paper px-4 py-3">
      <span>
        <span className="block text-sm font-medium text-espresso">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
      <span aria-hidden className="relative h-6 w-11 shrink-0 rounded-full bg-sand transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-espresso peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-espresso/40" />
    </label>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  const cls = {
    neutral: "bg-mist text-charcoal",
    good: "bg-success/10 text-success",
    warn: "bg-bronze/15 text-bronze-strong",
    bad: "bg-danger/10 text-danger",
    info: "bg-espresso/10 text-espresso",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-muted">{children}</p>;
}

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link href={href} className={variant === "primary" ? "rounded-lg bg-espresso px-4 py-2 text-sm font-medium text-cream hover:bg-espresso/90" : "rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-espresso hover:bg-mist"}>
      {children}
    </Link>
  );
}

export function Table({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-sm" data-testid={testId}>{children}</table>
    </div>
  );
}
export const thCls = "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted";
export const tdCls = "border-t border-line px-4 py-3 align-top";

/** Settings panel header (icon, title, description), as in the settings screenshots. */
export function SettingsPanel({ title, description, icon, children }: { title: string; description: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-line bg-white">
      <div className="flex items-start gap-3 border-b border-line px-6 py-5">
        <span className="grid size-10 place-items-center rounded-lg bg-cream text-espresso">{icon}</span>
        <div>
          <h2 className="text-lg font-semibold text-espresso">{title}</h2>
          <p className="text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="divide-y divide-line px-6">{children}</div>
    </section>
  );
}

/** Two-column row: label + help on the left, fields on the right. */
export function SettingsRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 py-6 md:grid-cols-[240px_1fr]">
      <div>
        <h3 className="text-sm font-semibold text-espresso">{title}</h3>
        {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}
