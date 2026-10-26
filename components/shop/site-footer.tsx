import Link from "next/link";
import { NewsletterForm } from "./newsletter-form";

const COLUMNS = [
  { title: "Shop", links: [["/shop", "All products"], ["/men", "Men"], ["/women", "Women"], ["/collections/new-arrivals", "New arrivals"]] },
  { title: "Help", links: [["/orders/track", "Track an order"], ["/shipping", "Shipping"], ["/returns", "Returns"], ["/size-guide", "Size guide"]] },
  { title: "Company", links: [["/about", "About"], ["/contact", "Contact"], ["/privacy", "Privacy"], ["/terms", "Terms"]] },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-espresso text-cream">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        <div>
          <p className="font-display text-2xl">Fabriklo</p>
          <p className="mt-3 text-sm text-cream/70">Considered clothing for everyday life in Bangladesh. Prices in BDT.</p>
          <NewsletterForm />
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-cream/60">{col.title}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {col.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="hover:underline underline-offset-4">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-cream/10 py-6 text-center text-xs text-cream/60">
        © {new Date().getFullYear()} Fabriklo. Store renders © their owner. Demo catalogue for development.
      </div>
    </footer>
  );
}
