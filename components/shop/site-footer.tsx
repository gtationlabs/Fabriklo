import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { getStoreContact, getStoreIdentity } from "@/lib/settings/public";
import { NewsletterForm } from "./newsletter-form";
import { Turnstile } from "@/components/security/turnstile";

const COLUMNS = [
  {
    title: "Shop",
    links: [
      ["/collections/new-arrivals", "New arrivals"],
      ["/men", "Men"],
      ["/women", "Women"],
      ["/category/accessories", "Accessories"],
      ["/shop", "All products"],
      ["/try-on", "AI try-on"],
    ],
  },
  {
    title: "Help",
    links: [
      ["/orders/track", "Track an order"],
      ["/shipping", "Shipping & delivery"],
      ["/returns", "Returns & exchanges"],
      ["/size-guide", "Size guide"],
      ["/faq", "FAQ"],
      ["/contact", "Contact us"],
    ],
  },
  {
    title: "Company",
    links: [
      ["/about", "About us"],
      ["/stores", "Our store"],
      ["/account", "My account"],
      ["/wishlist", "Wishlist"],
      ["/privacy", "Privacy policy"],
      ["/terms", "Terms of service"],
    ],
  },
] as const;

export async function SiteFooter() {
  const [identity, contact] = await Promise.all([getStoreIdentity(), getStoreContact()]);
  return (
    <footer className="bg-ink font-catalog text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <p className="text-[20px] font-semibold uppercase tracking-[0.28em]">{identity.name}</p>
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-white/70">
            {(identity.tagline || "Considered clothing for everyday life in Bangladesh").replace(/[.!]?$/, ".")} Prices in BDT, cash on delivery across Bangladesh.
          </p>
          {contact ? (
            <address className="mt-4 space-y-1.5 text-[13px] not-italic text-white/75">
              <a href={`tel:${contact.phone}`} className="flex min-h-6 items-center gap-2 hover:underline">
                <Phone aria-hidden className="h-3.5 w-3.5" />
                {contact.phone}
              </a>
              <a href={`mailto:${contact.email}`} className="flex min-h-6 items-center gap-2 hover:underline">
                <Mail aria-hidden className="h-3.5 w-3.5" />
                {contact.email}
              </a>
              {contact.address ? (
                <p className="flex items-start gap-2">
                  <MapPin aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {contact.address}
                </p>
              ) : null}
              {contact.hours ? <p className="pl-[22px]">{contact.hours}</p> : null}
            </address>
          ) : null}
          <div className="mt-6 max-w-sm">
            <NewsletterForm challenge={<Turnstile action="newsletter" />} />
          </div>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">{col.title}</h2>
            <ul className="mt-4 space-y-2.5 text-[13px]">
              {col.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-white/85 underline-offset-4 hover:text-white hover:underline">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-[12px] text-white/55 sm:px-6">
          <p>
            © {new Date().getFullYear()} {identity.name}. All prices in BDT.
          </p>
          <p>Store renders © their owner. Demo catalogue for development.</p>
        </div>
      </div>
    </footer>
  );
}
