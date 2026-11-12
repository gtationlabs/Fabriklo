import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { Blocks } from "@/components/cms/blocks";
import { SizeChart } from "@/components/cms/size-chart";
import { StorePage } from "@/components/shop/store-page";
import { getPublishedPage } from "@/lib/cms/pages";
import { HELP_NAV, fallbackPage, type ResolvedPage } from "@/lib/cms/fallback-pages";
import { getStoreContact } from "@/lib/settings/public";

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Asia/Dhaka" });

/** The published CMS page, or the built-in template for the footer's help/legal links. */
async function resolvePage(slug: string): Promise<ResolvedPage | null> {
  const page = await getPublishedPage(slug);
  if (page) return { ...page, builtIn: false };
  return fallbackPage(slug);
}

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await resolvePage(slug);
  if (!page) return {};
  return { title: page.seo_title ?? page.title, description: page.seo_description ?? undefined };
}

async function ContactCards() {
  const contact = await getStoreContact();
  if (!contact) {
    return (
      <p role="note" className="mb-8 rounded-[6px] border border-dashed border-neutral-300 bg-mist p-4 text-[14px] text-neutral-700" data-testid="contact-placeholder">
        Contact details will appear here once the store adds its phone number, email and address in Admin → Settings.
      </p>
    );
  }
  const items = [
    { icon: Phone, label: "Call us", value: contact.phone, href: `tel:${contact.phone}` },
    { icon: Mail, label: "Email", value: contact.email, href: `mailto:${contact.email}` },
    ...(contact.address ? [{ icon: MapPin, label: "Visit", value: contact.address, href: "/stores" }] : []),
    ...(contact.hours ? [{ icon: Clock, label: "Opening hours", value: contact.hours, href: null }] : []),
  ];
  return (
    <ul className="mb-10 grid gap-3 sm:grid-cols-2" data-testid="contact-cards">
      {items.map(({ icon: Icon, label, value, href }) => (
        <li key={label} className="rounded-[6px] border border-neutral-200 bg-mist p-5">
          <Icon aria-hidden className="h-5 w-5" strokeWidth={1.6} />
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">{label}</p>
          {href ? (
            <a href={href} className="mt-1 block break-words text-[15px] font-medium underline-offset-4 hover:underline">
              {value}
            </a>
          ) : (
            <p className="mt-1 text-[15px] font-medium">{value}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function CmsPageRoute({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  const page = await resolvePage(slug);
  if (!page) notFound();
  const withMenu = page.kind !== "page";
  const here = `/${page.slug}`;

  const body = (
    <article className="min-w-0">
      {page.kind === "legal" && page.published_at ? <p className="mb-6 text-[13px] text-neutral-600">Last updated {dateFmt.format(new Date(page.published_at))}</p> : null}
      {page.slug === "contact" ? <ContactCards /> : null}
      <Blocks blocks={page.blocks} />
      {page.slug === "size-guide" ? <SizeChart /> : null}
    </article>
  );

  return (
    <StorePage
      title={page.title}
      crumbs={[...(withMenu ? [{ href: "/faq", label: page.kind === "legal" ? "Legal" : "Help" }] : []), { label: page.title }]}
      width={withMenu ? "default" : "text"}
      testId={page.builtIn ? "builtin-page" : "cms-page"}
    >
      {withMenu ? (
        <div className="grid gap-10 md:grid-cols-[200px_1fr] md:gap-14">
          <aside className="order-last md:order-first">
            {HELP_NAV.map((group) => (
              <nav key={group.title} aria-label={`${group.title} pages`} className="mb-8">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">{group.title}</h2>
                <ul className="mt-3 space-y-1 text-[14px]">
                  {group.links.map(([href, label]) => (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={href === here ? "page" : undefined}
                        className={`block border-l-2 py-1.5 pl-3 transition ${href === here ? "border-ink font-medium" : "border-transparent text-neutral-600 hover:border-neutral-300 hover:text-ink"}`}
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </aside>
          {body}
        </div>
      ) : (
        body
      )}
    </StorePage>
  );
}
