import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Clock, MapPin, Navigation, Phone } from "lucide-react";
import { StorePage, btnOutline, btnPrimary } from "@/components/shop/store-page";
import { getStoreContact, getStoreIdentity } from "@/lib/settings/public";

export const metadata: Metadata = { title: "Our store", description: "Visit the store: address, opening hours and directions." };

const GALLERY = [
  { src: "/assets/store/store-02-1280.webp", alt: "Shelving wall with folded clothing along the left side of the store.", caption: "Shirts & knitwear" },
  { src: "/assets/store/store-03-1280.webp", alt: "Trouser display on the right side of the store.", caption: "Trousers" },
  { src: "/assets/store/store-04-1280.webp", alt: "Checkout counters at the back of the store.", caption: "Checkout" },
  { src: "/assets/store/store-05-1280.webp", alt: "Row of fitting rooms with curtains.", caption: "Fitting rooms" },
];

/** Store locator. Details come from Admin → Settings → contact; a note shows until they are set. */
export default async function StoresPage() {
  const [identity, contact] = await Promise.all([getStoreIdentity(), getStoreContact()]);
  const mapsHref = contact?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${identity.name} ${contact.address}`)}` : null;

  return (
    <StorePage title="Our store" width="wide" intro="Come in to see the pieces up close, try them on and pick up your size.">
      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr] lg:gap-12">
        <div className="relative aspect-[16/10] overflow-hidden rounded-[6px] bg-neutral-200">
          <Image src="/assets/store/store-01-1280.webp" alt="Wide view of the store entrance with wooden ceiling and clothing racks." fill priority sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover" />
        </div>
        <div className="flex flex-col justify-center" data-testid="store-details">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">Flagship</p>
          <h2 className="mt-2 text-[24px] font-medium uppercase tracking-[0.12em]">{identity.name}</h2>
          {contact ? (
            <dl className="mt-6 space-y-5 text-[14px]">
              <div className="flex gap-3">
                <dt><MapPin aria-label="Address" className="mt-0.5 h-5 w-5" strokeWidth={1.6} /></dt>
                <dd>{contact.address || "Address to be confirmed"}</dd>
              </div>
              <div className="flex gap-3">
                <dt><Clock aria-label="Opening hours" className="mt-0.5 h-5 w-5" strokeWidth={1.6} /></dt>
                <dd>{contact.hours || "Opening hours to be confirmed"}</dd>
              </div>
              <div className="flex gap-3">
                <dt><Phone aria-label="Phone" className="mt-0.5 h-5 w-5" strokeWidth={1.6} /></dt>
                <dd><a href={`tel:${contact.phone}`} className="underline underline-offset-4 hover:no-underline">{contact.phone}</a></dd>
              </div>
            </dl>
          ) : (
            <p role="note" className="mt-6 rounded-[6px] border border-dashed border-neutral-300 bg-mist p-4 text-[14px] text-neutral-700" data-testid="store-placeholder">
              The store address, opening hours and phone number will appear here once they are added in Admin → Settings.
            </p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            {mapsHref ? (
              <a href={mapsHref} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
                <Navigation aria-hidden className="h-4 w-4" strokeWidth={1.6} />
                Get directions
              </a>
            ) : null}
            <Link href="/contact" className={btnOutline}>
              Contact us
            </Link>
          </div>
        </div>
      </div>

      <section aria-labelledby="inside-h" className="mt-20">
        <h2 id="inside-h" className="text-center text-[13px] font-semibold uppercase tracking-[0.2em]">Inside the store</h2>
        <ul className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {GALLERY.map((g) => (
            <li key={g.src}>
              <figure>
                <div className="relative aspect-[4/5] overflow-hidden rounded-[4px] bg-neutral-200">
                  <Image src={g.src} alt={g.alt} fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover transition duration-700 hover:scale-[1.03]" />
                </div>
                <figcaption className="mt-2 text-[13px]">{g.caption}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-[12px] text-neutral-500">Store pictures are design renders, not photographs.</p>
      </section>
    </StorePage>
  );
}
