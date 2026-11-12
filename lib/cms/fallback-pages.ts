import type { Block, CmsPage } from "./blocks";

/**
 * Built-in starter text for the help, company and legal pages that the
 * header and footer link to. It is used only when the database has no
 * published page for that slug (for example a fresh production project
 * without the seed), so those links never 404. Every page opens with a
 * visible "template" warning; publishing a page with the same slug in
 * Admin → Content replaces it.
 */
type Fallback = Pick<CmsPage, "slug" | "title" | "kind" | "seo_description"> & { blocks: Block[] };

const TEMPLATE_NOTE = "Template page: this is starter text shipped with the site. Replace it in Admin → Content before launch.";
const LEGAL_NOTE = "Template only, not legal advice. Have this reviewed by a qualified professional before launch.";

const PAGES: Fallback[] = [
  {
    slug: "shipping",
    title: "Shipping & delivery",
    kind: "help",
    seo_description: "How delivery works, delivery areas and timelines.",
    blocks: [
      { type: "callout", tone: "warning", text: "Template page: confirm delivery partners, areas and timelines before launch." },
      { type: "paragraph", text: "We deliver across all 64 districts of Bangladesh. The delivery charge and the expected delivery time for your district are shown at checkout before you place your order." },
      { type: "heading", level: 2, text: "How it works" },
      { type: "list", style: "number", items: ["Place your order and choose cash on delivery.", "We call or text to confirm your order before dispatch.", "We pack your order and hand it to our delivery partner.", "Pay the rider in cash when your parcel arrives."] },
      { type: "heading", level: 2, text: "Tracking your order" },
      { type: "paragraph", text: "After checkout you get a private tracking link. If you have an account, your orders are also listed under **My account**. You can always [track an order](/orders/track) with your order number and tracking code." },
      { type: "faq", items: [
        { q: "Can I change my address after ordering?", a: "Contact us as soon as possible. We can update the address until the parcel is handed to the courier." },
        { q: "What if I am not home?", a: "The rider will call you. If delivery fails, we will try again or contact you to arrange a new time." },
      ] },
      { type: "cta", label: "Start shopping", href: "/shop" },
    ],
  },
  {
    slug: "returns",
    title: "Returns & exchanges",
    kind: "help",
    seo_description: "How to return or exchange an item.",
    blocks: [
      { type: "callout", tone: "warning", text: "Template page: set your real return window, conditions and refund method before launch." },
      { type: "paragraph", text: "If something does not fit or is not what you expected, contact us within the return window shown here once it is confirmed by the store." },
      { type: "heading", level: 2, text: "Conditions" },
      { type: "list", style: "bullet", items: ["Items must be unworn, unwashed and with tags attached.", "Keep the original packaging where possible.", "Some items, such as innerwear, may not be returnable."] },
      { type: "heading", level: 2, text: "How to start a return" },
      { type: "paragraph", text: "Contact us with your order number. We will explain the next steps and any pickup or drop-off options." },
      { type: "cta", label: "Contact us", href: "/contact" },
    ],
  },
  {
    slug: "size-guide",
    title: "Size guide",
    kind: "help",
    seo_description: "Find your size.",
    blocks: [
      { type: "callout", tone: "info", text: "Template page: add measurements for your actual garments." },
      { type: "paragraph", text: "Measurements vary by style. Check the product page for fit notes, and contact us if you are between sizes." },
      { type: "heading", level: 2, text: "How to measure" },
      { type: "list", style: "bullet", items: ["Chest: around the fullest part, under the arms.", "Waist: around your natural waistline.", "Inseam: from the crotch to the bottom of the ankle."] },
    ],
  },
  {
    slug: "faq",
    title: "Frequently asked questions",
    kind: "help",
    seo_description: "Answers about orders, delivery, payment, accounts and AI try-on.",
    blocks: [
      { type: "callout", tone: "warning", text: TEMPLATE_NOTE },
      { type: "heading", level: 2, text: "Orders & payment" },
      { type: "faq", items: [
        { q: "How do I pay?", a: "Cash on delivery is available across Bangladesh: pay the rider when your parcel arrives. Online payment appears at checkout once the store switches it on." },
        { q: "Do I need an account to order?", a: "No. You can check out as a guest. An account keeps your order history and saved addresses in one place." },
        { q: "Will you confirm my order?", a: "Yes. We call or text the number you give at checkout to confirm the order before it is dispatched." },
        { q: "Can I cancel an order?", a: "Contact us as soon as possible with your order number. Orders can be cancelled until they are handed to the courier." },
      ] },
      { type: "heading", level: 2, text: "Delivery & tracking" },
      { type: "faq", items: [
        { q: "How much is delivery and how long does it take?", a: "The delivery charge and the usual delivery time for your district are shown at checkout, before you place the order. See [shipping & delivery](/shipping)." },
        { q: "How do I track my order?", a: "Use the private tracking link shown after checkout, or [track an order](/orders/track) with your order number and tracking code. Signed-in customers also see every order under My account." },
      ] },
      { type: "heading", level: 2, text: "Sizes, returns & exchanges" },
      { type: "faq", items: [
        { q: "How do I find my size?", a: "Each product page links to the [size guide](/size-guide). If you are between sizes, contact us and we will help." },
        { q: "Can I return or exchange something?", a: "Yes, within the return window and conditions on the [returns page](/returns)." },
      ] },
      { type: "heading", level: 2, text: "AI try-on" },
      { type: "faq", items: [
        { q: "What is AI try-on?", a: "On supported products you can upload a photo of yourself and see a computer-generated preview of the garment on you. It is an illustration, so colour and fit can differ from the real piece. Read [how it works](/try-on)." },
        { q: "What happens to my photo?", a: "Your photo stays private to your account, is never shown to staff, and is deleted automatically when it expires. You can delete it yourself at any time." },
      ] },
      { type: "cta", label: "Still need help? Contact us", href: "/contact" },
    ],
  },
  {
    slug: "about",
    title: "About us",
    kind: "page",
    seo_description: "About the store.",
    blocks: [
      { type: "callout", tone: "info", text: "Template page: tell your own story here." },
      { type: "paragraph", text: "We make considered, comfortable clothing for everyday life in Bangladesh." },
      { type: "image", path: "/assets/store/store-01.webp", alt: "Wide view of the store entrance with wooden ceiling and clothing racks.", caption: "Our store" },
      { type: "cta", label: "Explore the collection", href: "/shop" },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    kind: "help",
    seo_description: "How to reach us.",
    blocks: [
      { type: "callout", tone: "warning", text: "Template page: add your real phone number, email, address and opening hours." },
      { type: "paragraph", text: "Questions about an order? Have your order number ready and contact us. We usually reply within one working day." },
      { type: "cta", label: "Track an order", href: "/orders/track" },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy policy",
    kind: "legal",
    seo_description: "How we handle personal data.",
    blocks: [
      { type: "callout", tone: "warning", text: LEGAL_NOTE },
      { type: "heading", level: 2, text: "What we collect" },
      { type: "list", style: "bullet", items: ["Order details: name, mobile number, delivery address, optional email.", "Account details if you create an account.", "Photos you choose to upload for virtual try-on, kept private and deleted on schedule."] },
      { type: "heading", level: 2, text: "How we use it" },
      { type: "paragraph", text: "To deliver your orders, contact you about them, prevent fraud, and improve the store. We do not sell your personal data." },
      { type: "heading", level: 2, text: "Your choices" },
      { type: "paragraph", text: "You can ask us to access, correct or delete your data. Contact us using the details on the [contact page](/contact)." },
    ],
  },
  {
    slug: "terms",
    title: "Terms of service",
    kind: "legal",
    seo_description: "Terms for using the store.",
    blocks: [
      { type: "callout", tone: "warning", text: LEGAL_NOTE },
      { type: "paragraph", text: "By placing an order you agree to these terms. Prices are in Bangladeshi Taka (BDT). We confirm every order before dispatch and may cancel an order if an item becomes unavailable or the order cannot be verified." },
      { type: "heading", level: 2, text: "Payment" },
      { type: "paragraph", text: "Cash on delivery is available. Online payment will be offered when it is enabled." },
    ],
  },
];

export const FALLBACK_SLUGS = PAGES.map((p) => p.slug);

/** A page ready to render: from the CMS, or built in. */
export type ResolvedPage = {
  slug: string;
  title: string;
  kind: CmsPage["kind"];
  seo_title: string | null;
  seo_description: string | null;
  blocks: Block[];
  /** Null for built-in pages: no "last updated" date is claimed. */
  published_at: string | null;
  builtIn: boolean;
};

export function fallbackPage(slug: string): ResolvedPage | null {
  const p = PAGES.find((x) => x.slug === slug);
  return p ? { ...p, seo_title: null, published_at: null, builtIn: true } : null;
}

/** Side menu shown on help and legal pages. */
export const HELP_NAV = [
  { title: "Help", links: [["/faq", "FAQ"], ["/shipping", "Shipping & delivery"], ["/returns", "Returns & exchanges"], ["/size-guide", "Size guide"], ["/orders/track", "Track an order"], ["/contact", "Contact us"]] },
  { title: "Company", links: [["/about", "About us"], ["/stores", "Our store"], ["/privacy", "Privacy policy"], ["/terms", "Terms of service"]] },
] as const;
