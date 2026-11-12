/**
 * Customer reviews shown on the home page.
 *
 * There is no review system yet, so the home page uses these SAMPLE reviews.
 * They are written for the design preview, are not from real customers, and the
 * section labels them as samples while `sample` is true. Replace them with real,
 * verified reviews (or wire this to a reviews table) before launch.
 */

export type Testimonial = {
  id: string;
  name: string;
  city: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  /** Short line for the moving ribbon. */
  quote: string;
  product: string;
  size: string;
  fit: "true" | "small" | "large" | null;
  /** Hang-tag colour (hex), picked to suit the piece. */
  swatch: string;
};

export type ReviewSummary = {
  average: number;
  count: number;
  /** Share of reviews per star, index 0 = 5 stars … index 4 = 1 star (0–1). */
  distribution: number[];
  /** Share of reviews that said the size was true to fit (0–1). */
  trueToSize: number;
};

export const SAMPLE_TESTIMONIALS: Testimonial[] = [
  {
    id: "s1",
    name: "Nusrat J.",
    city: "Dhaka",
    rating: 5,
    title: "The linen actually breathes",
    body: "Wore it to a June wedding in Gulshan and stayed cool the whole evening. The stitching on the cuffs is neat enough that people asked where it was from.",
    quote: "Stayed cool the whole evening.",
    product: "Linen band-collar shirt",
    size: "M",
    fit: "true",
    swatch: "#c9b48f",
  },
  {
    id: "s2",
    name: "Tanvir R.",
    city: "Chattogram",
    rating: 5,
    title: "Trousers that survive the commute",
    body: "Two months of buses and rickshaws and the crease still holds. Ordered with cash on delivery and it arrived in three days.",
    quote: "The crease still holds after two months.",
    product: "Tapered chino",
    size: "32",
    fit: "true",
    swatch: "#5f6b52",
  },
  {
    id: "s3",
    name: "Farhana A.",
    city: "Sylhet",
    rating: 4,
    title: "Lovely colour, runs a little small",
    body: "The rust shade is even nicer in person. I'd size up if you are between sizes, the shoulders are cut slim.",
    quote: "Even nicer in person.",
    product: "Relaxed cotton tee",
    size: "L",
    fit: "small",
    swatch: "#a5532e",
  },
  {
    id: "s4",
    name: "Imran H.",
    city: "Dhaka",
    rating: 5,
    title: "Exchange was painless",
    body: "Needed a different size and the swap was arranged over the phone. The new one came with the courier who collected the old one.",
    quote: "The swap was arranged in one call.",
    product: "Overshirt jacket",
    size: "XL",
    fit: "large",
    swatch: "#3b3a36",
  },
  {
    id: "s5",
    name: "Sadia K.",
    city: "Rajshahi",
    rating: 5,
    title: "Feels more expensive than it is",
    body: "Heavy cotton, soft from the first wash, and the colour didn't run. I've bought the same tee in two more colours.",
    quote: "Bought it again in two more colours.",
    product: "Heavyweight crew tee",
    size: "S",
    fit: "true",
    swatch: "#2f4a6b",
  },
  {
    id: "s6",
    name: "Arif M.",
    city: "Khulna",
    rating: 4,
    title: "Great fit, wish there were more colours",
    body: "The cut through the leg is exactly what I wanted. Only gripe is I'd like a navy option.",
    quote: "Exactly the cut I wanted.",
    product: "Straight denim",
    size: "34",
    fit: "true",
    swatch: "#44597a",
  },
  {
    id: "s7",
    name: "Mehjabin T.",
    city: "Dhaka",
    rating: 5,
    title: "My Eid outfit sorted",
    body: "The fabric drapes beautifully and the embroidery is subtle. Packaging was lovely too, felt like opening a gift.",
    quote: "Felt like opening a gift.",
    product: "Embroidered kurti",
    size: "M",
    fit: "true",
    swatch: "#7c3b4d",
  },
];

/** Average (one decimal), count, star distribution and true-to-size share. */
export function summarizeReviews(reviews: Pick<Testimonial, "rating" | "fit">[]): ReviewSummary {
  const count = reviews.length;
  if (count === 0) return { average: 0, count: 0, distribution: [0, 0, 0, 0, 0], trueToSize: 0 };
  const total = reviews.reduce((s, r) => s + r.rating, 0);
  const distribution = [5, 4, 3, 2, 1].map((star) => reviews.filter((r) => r.rating === star).length / count);
  return {
    average: Math.round((total / count) * 10) / 10,
    count,
    distribution,
    // Share among the reviews that said anything about fit.
    trueToSize: (() => {
      const told = reviews.filter((r) => r.fit !== null).length;
      return told ? reviews.filter((r) => r.fit === "true").length / told : 0;
    })(),
  };
}

export const FIT_LABEL: Record<NonNullable<Testimonial["fit"]>, string> = {
  true: "True to size",
  small: "Runs small",
  large: "Runs large",
};

const SWATCHES = ["#c9b48f", "#5f6b52", "#a35f3c", "#7d8fa3", "#b9a28a", "#6b4e3d", "#8c8a6f"];

export type FeaturedReviewRow = {
  id: string; author_name: string; author_city: string; rating: number; title: string; body: string;
  fit: "true" | "small" | "large" | null; size_bought: string | null; product_title: string;
};

/** Approved, featured reviews from Admin → Reviews, shaped for the home deck. */
export function toTestimonials(rows: FeaturedReviewRow[]): Testimonial[] {
  return rows.map((r, i) => {
    const first = r.body.split(/(?<=[.!?])\s/)[0] ?? r.body;
    return {
      id: r.id,
      name: r.author_name,
      city: r.author_city,
      rating: Math.min(5, Math.max(1, Math.round(r.rating))) as Testimonial["rating"],
      title: r.title || first.slice(0, 60),
      body: r.body,
      quote: first.length > 90 ? `${first.slice(0, 87)}…` : first,
      product: r.product_title,
      size: r.size_bought ?? "",
      fit: r.fit,
      swatch: SWATCHES[i % SWATCHES.length]!,
    };
  });
}

/** Real reviews once at least three are featured; the labelled samples until then. */
export function pickHomeTestimonials(featured: FeaturedReviewRow[]): { reviews: Testimonial[]; sample: boolean } {
  if (featured.length >= 3) return { reviews: toTestimonials(featured), sample: false };
  return { reviews: SAMPLE_TESTIMONIALS, sample: true };
}

/** The reviews the home page shows, and whether they are samples. */
export function getHomeTestimonials(): { reviews: Testimonial[]; sample: boolean } {
  return { reviews: SAMPLE_TESTIMONIALS, sample: true };
}
