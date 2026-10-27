import Link from "next/link";
import { getStoreContact, getStoreIdentity } from "@/lib/settings/public";
import { NewsletterForm } from "./newsletter-form";
import { Turnstile } from "@/components/security/turnstile";

const COLUMNS = [
  { title: "Shop", links: [["/shop", "All products"], ["/men", "Men"], ["/women", "Women"], ["/collections/new-arrivals", "New arrivals"]] },
  { title: "Help", links: [["/orders/track", "Track an order"], ["/shipping", "Shipping"], ["/returns", "Returns"], ["/size-guide", "Size guide"]] },
  { title: "Company", links: [["/about", "About"], ["/contact", "Contact"], ["/privacy", "Privacy"], ["/terms", "Terms"]] },
] as const;

export async function SiteFooter() {
  const [identity, contact] = await Promise.all([getStoreIdentity(), getStoreContact()]);
  return (
    <footer className="mt-24 bg-espresso text-cream">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        <div>
          <p className="font-display text-2xl">{identity.name}</p>
          <p className="mt-3 text-sm text-cream/70">{identity.tagline || "Considered clothing for everyday life in Bangladesh."} Prices in BDT.</p>
          {contact ? (
            <address className="mt-3 space-y-1 text-sm not-italic text-cream/70">
              <a href={`mailto:${contact.email}`} className="inline-block min-h-6 py-0.5 hover:underline">{contact.email}</a>
              <br />
              <a href={`tel:${contact.phone}`} className="inline-block min-h-6 py-0.5 hover:underline">{contact.phone}</a>
              {contact.address ? <p>{contact.address}</p> : null}
              {contact.hours ? <p>{contact.hours}</p> : null}
            </address>
          ) : null}
          <NewsletterForm challenge={<Turnstile action="newsletter" />} />
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
        © {new Date().getFullYear()} {identity.name}. Store renders © their owner. Demo catalogue for development.
      </div>
    </footer>
  );
}
