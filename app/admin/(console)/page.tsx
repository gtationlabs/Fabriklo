import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  History,
  ImageIcon,
  type LucideIcon,
  MessageSquareText,
  Package,
  PackageCheck,
  PackageOpen,
  Plus,
  Receipt,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Star,
  Tag,
  Truck,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { TrendChart } from "@/components/admin/dashboard/charts";
import { BarList, Sparkline, SplitBar } from "@/components/admin/dashboard/figures";
import { StatusPill } from "@/components/admin/status-pill";
import { DASHBOARD_RANGES, type DashboardStats, loadDashboardStats, parseRange, pctChange } from "@/lib/admin/dashboard";
import type { Permission } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const num = new Intl.NumberFormat("en");
const ROLE_NAMES: Record<string, string> = {
  super_admin: "Owner",
  admin: "Admin",
  store_manager: "Store manager",
  support_agent: "Support staff",
};
const SCOPE_LABELS: [keyof DashboardStats["scope"], string][] = [
  ["sales", "Sales & revenue"],
  ["orders", "Orders"],
  ["risk", "Risk review"],
  ["catalog", "Catalogue"],
  ["inventory", "Stock"],
  ["customers", "Customers"],
  ["reviews", "Reviews"],
  ["activity", "Team activity"],
];

export default async function AdminOverview({ searchParams }: PageProps<"/admin">) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const result = await loadDashboardStats(range);
  const can = (p: Permission) => staff.permissions.includes(p);

  const deniedNote = sp.denied ? (
    <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
      You don&apos;t have the “{String(sp.denied)}” permission for that page.
    </p>
  ) : null;

  if (result.kind !== "ok") {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-semibold text-espresso">Dashboard</h1>
        {deniedNote}
        <div role="status" className="rounded-xl border border-bronze/30 bg-bronze/5 p-4 text-sm text-espresso">
          {result.kind === "missing_migration" ? (
            <>
              <p className="font-semibold">Full statistics need one database update.</p>
              <p className="mt-1 text-muted">
                Run <code className="rounded bg-white px-1.5 py-0.5">npx supabase db push --linked</code> in the project folder to add the
                dashboard statistics function, then reload this page. Basic counts are shown below until then.
              </p>
            </>
          ) : (
            <p>Statistics could not be loaded right now ({result.message}). Basic counts are shown below.</p>
          )}
        </div>
        <BasicCounts can={can} />
      </div>
    );
  }

  const s = result.stats;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dhaka" }).format(new Date(s.generated_at)));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const updated = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }).format(new Date(s.generated_at));
  const firstName = staff.displayName.split(/[\s@]/)[0] || "there";
  const roleName = ROLE_NAMES[staff.role] ?? staff.role.replace(/_/g, " ");
  const periodLabel = `last ${s.days} days`;

  return (
    <div className="dash-root space-y-6">
      {deniedNote}

      {/* Welcome banner + the one filter row (date range scopes everything below). */}
      <section className="relative overflow-hidden rounded-2xl bg-espresso px-6 py-6 text-cream sm:px-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-bronze/30 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-40 size-64 rounded-full bg-wood/40 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cream/60">Dashboard</p>
            <h1 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">
              {greeting}, {firstName}
            </h1>
            <p className="mt-1 text-sm text-cream/75">
              Here is how the store is doing over the {periodLabel}. Updated {updated} (Dhaka time).
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full bg-cream px-2.5 py-1 font-semibold text-espresso">{roleName}</span>
              <span className="text-cream/60">sees</span>
              {SCOPE_LABELS.filter(([k]) => s.scope[k]).map(([k, l]) => (
                <span key={k} className="rounded-full border border-cream/25 px-2.5 py-1 text-cream/85">
                  {l}
                </span>
              ))}
            </p>
          </div>
          <nav aria-label="Date range" className="flex rounded-xl bg-white/10 p-1 text-sm backdrop-blur">
            {DASHBOARD_RANGES.map((r) => (
              <Link
                key={r}
                href={r === 30 ? "/admin" : `/admin?range=${r}`}
                aria-current={r === range ? "true" : undefined}
                className={`rounded-lg px-3.5 py-1.5 transition ${r === range ? "bg-cream font-semibold text-espresso shadow" : "text-cream/80 hover:bg-white/10 hover:text-cream"}`}
              >
                {r} days
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <KpiRow s={s} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <TrendCard s={s} />
        </div>
        <AttentionCard s={s} />
      </div>

      {s.orders || s.sales ? (
        <div className="grid gap-6 xl:grid-cols-3">
          {s.orders ? (
            <div className={`min-w-0 ${s.sales ? "xl:col-span-2" : "xl:col-span-3"}`}>
              <PipelineCard o={s.orders} />
            </div>
          ) : null}
          {s.sales ? <PaymentCard sales={s.sales} /> : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {s.sales ? (
          <Panel title="Sales by category" subtitle={`Item revenue, ${periodLabel}`} icon={Tag}>
            <BarList
              rows={s.sales.by_category.map((c) => ({ name: c.name, value: c.revenue_minor }))}
              formatValue={formatBDT}
              detail={(r) => `${r.name}: ${formatBDT(r.value)}, ${num.format(s.sales!.by_category.find((c) => c.name === r.name)?.units ?? 0)} units`}
              empty="No sales in this period yet."
            />
          </Panel>
        ) : null}
        {s.sales ? <TopProducts sales={s.sales} periodLabel={periodLabel} /> : null}
        {s.catalog ? (
          <Panel title="Catalogue" subtitle="Live products per category" icon={Package} href="/admin/categories" hrefLabel="Categories">
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <MiniStat label="Active" value={s.catalog.active} />
              <MiniStat label="Drafts" value={s.catalog.draft} href="/admin/products?status=draft" />
              <MiniStat label="Categories" value={s.catalog.active_categories} />
            </div>
            <BarList
              rows={s.catalog.by_category.slice(0, 6).map((c) => ({ name: c.name, value: c.products }))}
              formatValue={(v) => `${num.format(v)} products`}
              empty="No active products yet."
            />
            <p className="mt-4 text-xs text-muted">
              {num.format(s.catalog.featured)} featured · {num.format(s.catalog.tryon)} with AI try-on · {num.format(s.catalog.new_products)} added in the {periodLabel}
            </p>
          </Panel>
        ) : null}
        {s.inventory ? <StockPanel inv={s.inventory} /> : null}
        {s.customers ? <CustomersPanel c={s.customers} periodLabel={periodLabel} /> : null}
        <QuickActions can={can} />
      </div>

      {s.orders || s.activity ? (
        <div className="grid gap-6 xl:grid-cols-3">
          {s.orders ? (
            <div className={`min-w-0 ${s.activity ? "xl:col-span-2" : "xl:col-span-3"}`}>
              <RecentOrders o={s.orders} showTotals={Boolean(s.sales)} />
            </div>
          ) : null}
          {s.activity ? <ActivityFeed items={s.activity} /> : null}
        </div>
      ) : null}

      <p className="text-xs text-muted">
        Figures come straight from the database and are limited to what your role can open. Revenue counts orders placed in the period that are not
        cancelled, failed, refunded or returned, including delivery charges.
        {s.orders && s.orders.demo > 0 ? ` ${num.format(s.orders.demo)} of ${num.format(s.orders.all_time)} orders are marked as demo orders.` : ""}
      </p>
    </div>
  );
}

/* ---------- building blocks ---------- */

function Panel({
  title,
  subtitle,
  icon: Icon,
  href,
  hrefLabel,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={`min-w-0 rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(20,20,20,0.04)] ${className}`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cream text-espresso">
            <Icon className="size-[18px]" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-espresso">{title}</h2>
            {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
          </div>
        </div>
        {href ? (
          <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted hover:text-espresso">
            {hrefLabel ?? "View all"} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Delta({ current, previous, invert = false }: { current: number; previous: number; invert?: boolean }) {
  const pct = pctChange(current, previous);
  if (pct == null) {
    return <span className="text-xs text-muted">{current > 0 ? "New this period" : "No earlier data"}</span>;
  }
  const up = pct >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${good ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span>
        {Math.abs(pct) >= 1000 ? ">999" : Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
      </span>
      <span className="sr-only">{up ? "up" : "down"} vs previous period</span>
    </span>
  );
}

type Tile = { label: string; value: string; icon: LucideIcon; foot: React.ReactNode; spark?: number[]; href?: string };

function KpiRow({ s }: { s: DashboardStats }) {
  const tiles: Tile[] = [];
  if (s.sales) {
    tiles.push({
      label: "Revenue",
      value: formatBDT(s.sales.revenue_minor),
      icon: Banknote,
      foot: <><Delta current={s.sales.revenue_minor} previous={s.sales.prev_revenue_minor} /><span className="text-xs text-muted">vs previous {s.days} days</span></>,
      spark: s.sales.daily.map((d) => d.revenue_minor),
    });
  }
  if (s.orders) {
    tiles.push({
      label: "Orders",
      value: num.format(s.orders.placed),
      icon: ShoppingBag,
      foot: <><Delta current={s.orders.placed} previous={s.orders.prev_placed} /><span className="text-xs text-muted">{num.format(s.orders.today)} today</span></>,
      spark: s.orders.daily.map((d) => d.orders),
      href: "/admin/orders",
    });
  }
  if (s.sales) {
    tiles.push({
      label: "Average order value",
      value: formatBDT(s.sales.aov_minor),
      icon: Receipt,
      foot: <><Delta current={s.sales.aov_minor} previous={s.sales.prev_aov_minor} /><span className="text-xs text-muted">{num.format(s.sales.units)} items sold</span></>,
    });
  } else if (s.orders) {
    tiles.push({
      label: "To confirm",
      value: num.format(s.orders.pipeline.to_confirm),
      icon: ClipboardList,
      foot: <span className="text-xs text-muted">{num.format(s.orders.pipeline.processing)} being packed</span>,
      href: "/admin/orders?view=open",
    });
  }
  if (s.customers) {
    tiles.push({
      label: "Customers",
      value: num.format(s.customers.total),
      icon: Users,
      foot: <><Delta current={s.customers.new} previous={s.customers.prev_new} /><span className="text-xs text-muted">{num.format(s.customers.new)} new</span></>,
      href: "/admin/users",
    });
  }
  if (s.catalog && tiles.length < 4) {
    tiles.push({
      label: "Live products",
      value: num.format(s.catalog.active),
      icon: Package,
      foot: <span className="text-xs text-muted">{num.format(s.catalog.draft)} drafts · {num.format(s.catalog.active_categories)} categories</span>,
      href: "/admin/products?status=active",
    });
  }
  if (s.inventory && tiles.length < 4) {
    tiles.push({
      label: "Stock alerts",
      value: num.format(s.inventory.low + s.inventory.out),
      icon: AlertTriangle,
      foot: <span className="text-xs text-muted">{num.format(s.inventory.out)} sold out · {num.format(s.inventory.low)} low</span>,
      href: "/admin/inventory",
    });
  }
  if (!tiles.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => {
        const body = (
          <>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-sm text-muted">{t.label}</dt>
              <span className="grid size-9 place-items-center rounded-xl bg-cream text-espresso transition group-hover:bg-espresso group-hover:text-cream">
                <t.icon className="size-[18px]" aria-hidden="true" />
              </span>
            </div>
            <div className="mt-1 flex items-end justify-between gap-3">
              <dd className="text-[28px] font-semibold leading-tight tracking-tight text-espresso">{t.value}</dd>
              {t.spark ? <Sparkline values={t.spark} label={`${t.label}, last ${Math.min(12, t.spark.length)} days`} /> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">{t.foot}</div>
          </>
        );
        return (
          <div key={t.label} className="group rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(20,20,20,0.04)] transition hover:-translate-y-0.5 hover:shadow-md">
            {t.href ? (
              <Link href={t.href} className="block">
                {body}
              </Link>
            ) : (
              body
            )}
          </div>
        );
      })}
    </dl>
  );
}

function TrendCard({ s }: { s: DashboardStats }) {
  if (s.sales) {
    return (
      <Panel title="Revenue" subtitle={`Per day, last ${s.days} days · ${formatBDT(s.sales.today_revenue_minor)} so far today`} icon={Banknote} className="h-full">
        <TrendChart
          points={s.sales.daily.map((d) => ({ d: d.d, value: d.revenue_minor }))}
          label="Revenue"
          unit="৳"
          axisDivisor={100}
          format="money"
          height={330}
        />
      </Panel>
    );
  }
  if (s.orders) {
    return (
      <Panel title="Orders per day" subtitle={`Last ${s.days} days`} icon={ShoppingBag} className="h-full" href="/admin/orders" hrefLabel="All orders">
        <TrendChart
          points={s.orders.daily.map((d) => ({ d: d.d, value: d.orders }))}
          kind="column"
          label="Orders"
          format="orders"
          height={290}
        />
      </Panel>
    );
  }
  return null;
}

type Attention = { label: string; count: number; href: string; icon: LucideIcon; tone: "danger" | "warn" | "info"; hint: string };

function AttentionCard({ s }: { s: DashboardStats }) {
  const items: Attention[] = [];
  if (s.risk) items.push({ label: "Orders to risk-check", count: s.risk.needs_review, href: "/admin/risk", icon: ShieldAlert, tone: "danger", hint: `${num.format(s.risk.high_open)} open high-risk orders` });
  if (s.orders) {
    items.push({ label: "New orders to confirm", count: s.orders.pipeline.to_confirm, href: "/admin/orders?view=open", icon: ClipboardList, tone: "warn", hint: "Call the customer, then confirm" });
    items.push({ label: "Delivery problems", count: s.orders.pipeline.problem, href: "/admin/orders?view=shipping", icon: Truck, tone: "danger", hint: "Failed delivery or returning to sender" });
    items.push({ label: "Abandoned checkouts", count: s.orders.open_leads, href: "/admin/checkout-leads?status=open", icon: UserPlus, tone: "info", hint: "Open leads to follow up" });
  }
  if (s.inventory) {
    items.push({ label: "Sold-out SKUs", count: s.inventory.out, href: "/admin/inventory", icon: PackageOpen, tone: "danger", hint: "Restock or hide sizes" });
    items.push({ label: "Low-stock SKUs", count: s.inventory.low, href: "/admin/inventory", icon: Boxes, tone: "warn", hint: "At or below reorder point" });
  }
  if (s.reviews) items.push({ label: "Reviews to moderate", count: s.reviews.pending, href: "/admin/reviews?status=pending", icon: MessageSquareText, tone: "info", hint: "Waiting for approval" });
  if (s.sales) items.push({ label: "Cash to collect (COD)", count: s.sales.cod_due_orders, href: "/admin/orders?view=cod", icon: Banknote, tone: "info", hint: `${formatBDT(s.sales.cod_due_minor)} delivered, not yet received` });
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => Number(b.count > 0) - Number(a.count > 0));
  const open = items.filter((i) => i.count > 0).length;
  const TONE = { danger: "bg-danger/10 text-danger", warn: "bg-bronze/15 text-bronze-strong", info: "bg-[#2a78d6]/10 text-[#1f5fae]" };
  return (
    <Panel title="Needs attention" subtitle={open ? `${open} item${open === 1 ? "" : "s"} waiting on the team` : "All clear right now"} icon={Zap} className="h-full">
      <ul className="-mx-2 divide-y divide-line/70">
        {sorted.map((i) => (
          <li key={i.label}>
            <Link href={i.href} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-mist">
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${i.count > 0 ? TONE[i.tone] : "bg-mist text-muted"}`}>
                {i.count > 0 ? <i.icon className="size-4" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${i.count > 0 ? "font-medium text-espresso" : "text-muted"}`}>{i.label}</span>
                <span className="block truncate text-xs text-muted">{i.hint}</span>
              </span>
              <span className={`text-lg font-semibold tabular-nums ${i.count > 0 ? "text-espresso" : "text-muted/60"}`}>{num.format(i.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PipelineCard({ o }: { o: NonNullable<DashboardStats["orders"]> }) {
  const stages: { key: string; label: string; count: number; icon: LucideIcon; href: string; note: string }[] = [
    { key: "to_confirm", label: "To confirm", count: o.pipeline.to_confirm, icon: ClipboardList, href: "/admin/orders?view=open", note: "Received" },
    { key: "processing", label: "Packing", count: o.pipeline.processing, icon: PackageCheck, href: "/admin/orders?view=open", note: "Confirmed → packed" },
    { key: "shipping", label: "With courier", count: o.pipeline.shipping, icon: Truck, href: "/admin/orders?view=shipping", note: "On the way" },
    { key: "delivered", label: "Delivered", count: o.delivered, icon: CheckCircle2, href: "/admin/orders?view=done", note: "Placed in this period" },
  ];
  const total = stages.reduce((n, st) => n + st.count, 0);
  return (
    <Panel title="Order pipeline" subtitle="Where open orders are right now" icon={Truck} href="/admin/orders" hrefLabel="Orders" className="h-full">
      <ol className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stages.map((st, idx) => (
          <li key={st.key} className="relative">
            <Link href={st.href} className="group block h-full rounded-xl border border-line bg-paper/60 p-4 transition hover:border-espresso/40 hover:bg-white">
              <div className="flex items-center justify-between text-muted">
                <st.icon className="size-4" aria-hidden="true" />
                <span className="text-[11px] uppercase tracking-wider">Step {idx + 1}</span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-espresso">{num.format(st.count)}</p>
              <p className="text-sm font-medium text-charcoal">{st.label}</p>
              <p className="text-xs text-muted">{st.note}</p>
              <div className="mt-3 h-1.5 rounded-full bg-[var(--viz-track)]">
                <div className="h-1.5 rounded-full" style={{ width: `${total ? Math.max((st.count / total) * 100, st.count ? 4 : 0) : 0}%`, background: "var(--viz-1)" }} />
              </div>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>{num.format(o.pipeline.problem)} delivery problems</span>
        <span>{num.format(o.cancelled)} cancelled this period</span>
        <span>{num.format(o.all_time)} orders all time</span>
      </p>
    </Panel>
  );
}

function PaymentCard({ sales }: { sales: NonNullable<DashboardStats["sales"]> }) {
  const cod = sales.payment_mix.find((p) => p.method === "cod");
  const online = sales.payment_mix.find((p) => p.method === "sslcommerz");
  return (
    <Panel title="How customers pay" subtitle="Revenue by payment method" icon={CreditCard}>
      <SplitBar
        label="Revenue by payment method"
        formatValue={formatBDT}
        parts={[
          { name: "Cash on delivery", value: cod?.revenue_minor ?? 0, color: "var(--viz-1)", detail: `${num.format(cod?.orders ?? 0)} orders` },
          { name: "Online (SSLCOMMERZ)", value: online?.revenue_minor ?? 0, color: "var(--viz-2)", detail: `${num.format(online?.orders ?? 0)} orders` },
        ]}
      />
      <div className="mt-5 rounded-xl bg-cream/70 p-4">
        <p className="text-xs uppercase tracking-wider text-muted">Cash still with couriers</p>
        <p className="mt-1 text-2xl font-semibold text-espresso">{formatBDT(sales.cod_due_minor)}</p>
        <p className="text-xs text-muted">{num.format(sales.cod_due_orders)} delivered COD orders, cash not yet received</p>
      </div>
    </Panel>
  );
}

function TopProducts({ sales, periodLabel }: { sales: NonNullable<DashboardStats["sales"]>; periodLabel: string }) {
  return (
    <Panel title="Best sellers" subtitle={`By revenue, ${periodLabel}`} icon={Star} href="/admin/products" hrefLabel="Products">
      {sales.top_products.length ? (
        <ol className="space-y-3">
          {sales.top_products.map((p, i) => (
            <li key={p.title} className="flex items-center gap-3">
              <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${i === 0 ? "bg-espresso text-cream" : "bg-cream text-espresso"}`}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-charcoal">{p.title}</span>
                <span className="block text-xs text-muted">{num.format(p.units)} sold</span>
              </span>
              <span className="text-sm font-semibold tabular-nums text-espresso">{formatBDT(p.revenue_minor)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-6 text-center text-sm text-muted">No sales in this period yet.</p>
      )}
    </Panel>
  );
}

function StockPanel({ inv }: { inv: NonNullable<DashboardStats["inventory"]> }) {
  const healthy = Math.max(inv.skus - inv.low - inv.out, 0);
  return (
    <Panel title="Stock health" subtitle={`${num.format(inv.skus)} active SKUs`} icon={Boxes} href="/admin/inventory" hrefLabel="Inventory">
      <SplitBar
        label="SKUs by stock level"
        formatValue={(v) => `${num.format(v)} SKUs`}
        parts={[
          { name: "In stock", value: healthy, color: "var(--viz-2)" },
          { name: "Low stock", value: inv.low, color: "var(--viz-1)" },
          { name: "Sold out", value: inv.out, color: "#a1301f" },
        ]}
      />
      <p className="mt-4 text-xs text-muted">
        {num.format(inv.units_available)} units ready to sell · {num.format(inv.reserved)} reserved for orders
      </p>
    </Panel>
  );
}

function CustomersPanel({ c, periodLabel }: { c: NonNullable<DashboardStats["customers"]>; periodLabel: string }) {
  const repeatRate = c.buyers ? Math.round(((c.repeat_buyers ?? 0) / c.buyers) * 100) : null;
  return (
    <Panel title="Customers" subtitle="Registered shoppers and buyers" icon={Users} href="/admin/users" hrefLabel="Users">
      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Accounts" value={c.total} />
        <MiniStat label={`New, ${periodLabel.replace("last ", "")}`} value={c.new} />
        {c.buyers != null ? <MiniStat label="Buyers" value={c.buyers} /> : null}
      </div>
      {repeatRate != null ? (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-charcoal">Repeat buyers</span>
            <span className="font-medium text-espresso">{repeatRate}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--viz-track)]">
            <div className="h-2 rounded-full" style={{ width: `${repeatRate}%`, background: "var(--viz-1)" }} />
          </div>
          <p className="mt-1 text-xs text-muted">{num.format(c.repeat_buyers ?? 0)} phone numbers ordered more than once</p>
        </div>
      ) : null}
    </Panel>
  );
}

function MiniStat({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <>
      <p className="text-xl font-semibold text-espresso">{num.format(value)}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl bg-mist px-2 py-3 transition hover:bg-cream">
      {inner}
    </Link>
  ) : (
    <div className="rounded-xl bg-mist px-2 py-3">{inner}</div>
  );
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" });

function RecentOrders({ o, showTotals }: { o: NonNullable<DashboardStats["orders"]>; showTotals: boolean }) {
  return (
    <Panel title="Recent orders" subtitle="The latest orders across all channels" icon={ShoppingBag} href="/admin/orders" hrefLabel="All orders" className="h-full">
      {o.recent.length ? (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-5 pb-2 font-medium">Order</th>
                <th className="px-3 pb-2 font-medium">Customer</th>
                <th className="px-3 pb-2 font-medium">Status</th>
                <th className="px-3 pb-2 font-medium">Payment</th>
                {showTotals ? <th className="px-5 pb-2 text-right font-medium">Total</th> : <th className="px-5 pb-2 text-right font-medium">Items</th>}
              </tr>
            </thead>
            <tbody>
              {o.recent.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-mist/60">
                  <td className="px-5 py-2.5">
                    <Link href={`/admin/orders/${r.id}`} className="font-medium text-espresso hover:underline">
                      {r.order_number}
                    </Link>
                    <span className="block text-xs text-muted">{timeFmt.format(new Date(r.placed_at))}</span>
                  </td>
                  <td className="px-3 py-2.5 text-charcoal">
                    {r.customer_name}
                    {r.is_demo ? <span className="ml-1.5 rounded bg-sand px-1 text-[10px] uppercase text-muted">demo</span> : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={r.risk_review_status === "needs_review" ? "needs_review" : r.shipment_status !== "not_shipped" ? r.shipment_status : r.fulfillment_status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs text-muted">{r.payment_method === "cod" ? "COD" : "Online"}</span>{" "}
                    <StatusPill status={r.payment_status} />
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-espresso">
                    {showTotals ? formatBDT(r.total_minor ?? 0) : num.format(r.items)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted">No orders yet. New orders will appear here as soon as they are placed.</p>
      )}
    </Panel>
  );
}

function QuickActions({ can }: { can: (p: Permission) => boolean }) {
  const actions: { label: string; href: string; icon: LucideIcon; perm: Permission | null }[] = [
    { label: "Add product", href: "/admin/products/new", icon: Plus, perm: "products.write" },
    { label: "Process orders", href: "/admin/orders?view=open", icon: ClipboardList, perm: "orders.read" },
    { label: "Adjust stock", href: "/admin/inventory", icon: Boxes, perm: "inventory.adjust" },
    { label: "Moderate reviews", href: "/admin/reviews", icon: MessageSquareText, perm: "reviews.moderate" },
    { label: "Home slider", href: "/admin/slider", icon: ImageIcon, perm: "cms.edit" },
    { label: "New coupon", href: "/admin/marketing/coupons", icon: Tag, perm: "marketing.manage" },
    { label: "Invite staff", href: "/admin/staff", icon: UserPlus, perm: "staff.manage" },
    { label: "Store settings", href: "/admin/settings", icon: Settings, perm: "settings.manage" },
  ];
  const mine = actions.filter((a) => a.perm === null || can(a.perm)).slice(0, 6);
  if (!mine.length) return null;
  return (
    <Panel title="Quick actions" icon={Zap}>
      <div className="grid grid-cols-2 gap-2">
        {mine.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="group flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm text-charcoal transition hover:border-espresso hover:bg-espresso hover:text-cream"
          >
            <a.icon className="size-4 text-muted transition group-hover:text-cream" aria-hidden="true" />
            {a.label}
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function ActivityFeed({ items }: { items: NonNullable<DashboardStats["activity"]> }) {
  const human = (a: string) => {
    const t = a.replace(/[._]/g, " ").trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  return (
    <Panel title="Team activity" subtitle="Latest changes in the audit log" icon={History} href="/admin/audit" hrefLabel="Audit log">
      {items.length ? (
        <ol className="relative space-y-4 border-l border-line pl-4">
          {items.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-white bg-bronze" aria-hidden="true" />
              <p className="text-sm text-charcoal">
                {human(e.entity_type)} <span className="text-muted">·</span> {human(e.action).toLowerCase()}
              </p>
              <p className="text-xs text-muted">
                {e.actor_name || (e.actor_role ? e.actor_role.replace(/_/g, " ") : "System")} · {timeFmt.format(new Date(e.occurred_at))}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-4 text-center text-sm text-muted">No activity recorded yet.</p>
      )}
    </Panel>
  );
}

/** Pre-migration fallback: the counts the dashboard showed before the statistics function existed. */
async function BasicCounts({ can }: { can: (p: Permission) => boolean }) {
  const supabase = await createSupabaseServerClient();
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: c, error } = await q;
    return error ? null : (c ?? 0);
  };
  const [active, drafts, alerts, orders] = await Promise.all([
    can("products.read") ? count(supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "active")) : null,
    can("products.read") ? count(supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft")) : null,
    can("inventory.read")
      ? supabase.rpc("admin_stock_alerts").then(({ data, error }) => (error ? null : (data as { low: number; out: number })))
      : null,
    can("orders.read") ? count(supabase.from("orders").select("id", { count: "exact", head: true })) : null,
  ]);
  const kpis = [
    { label: "Active products", value: active },
    { label: "Draft products", value: drafts },
    { label: "Low-stock SKUs", value: alerts ? alerts.low : null },
    { label: "Sold-out SKUs", value: alerts ? alerts.out : null },
    { label: "Orders (all time)", value: orders },
  ].filter((k) => k.value !== null);
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-lg border border-line bg-white p-5">
          <dt className="text-xs uppercase tracking-wider text-muted">{k.label}</dt>
          <dd className="mt-2 text-3xl font-semibold text-espresso">{k.value}</dd>
        </div>
      ))}
    </dl>
  );
}
