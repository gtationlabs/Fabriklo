import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import type { ProductReviews } from "@/lib/reviews/queries";
import { FIT_LABEL } from "@/lib/reviews/testimonials";
import { submitReview } from "@/app/(shop)/product/[slug]/review-actions";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-[15px] tracking-[2px] text-ink" aria-label={`${rating} out of 5 stars`}>
      {"★★★★★".slice(0, Math.round(rating))}<span className="text-neutral-300">{"★★★★★".slice(Math.round(rating))}</span>
    </span>
  );
}

const input = "w-full border border-neutral-300 bg-white px-3 py-2 text-[14px] outline-none focus:border-ink";

/** Approved reviews for a product, plus the form for signed-in customers (held for moderation). */
export function ProductReviewsSection({ productId, slug, data, signedIn, defaultName, sizes }: { productId: string; slug: string; data: ProductReviews; signedIn: boolean; defaultName: string; sizes: string[] }) {
  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="mt-20 grid gap-10 lg:grid-cols-[320px_1fr]" data-testid="product-reviews">
      <div>
        <h2 id="reviews-heading" className="text-[22px] font-medium text-ink">Reviews</h2>
        {data.count ? (
          <p className="mt-2 flex items-center gap-3 text-[14px] text-neutral-700"><Stars rating={data.average ?? 0} /> {data.average?.toFixed(1)} from {data.count} review{data.count === 1 ? "" : "s"}</p>
        ) : (
          <p className="mt-2 text-[14px] text-neutral-600">No reviews yet.</p>
        )}
        <div className="mt-6">
          {signedIn ? (
            <details className="border border-neutral-300 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium text-ink">Write a review</summary>
              <div className="border-t border-neutral-200 p-4">
                <ActionForm action={submitReview.bind(null, productId)} label="Write a review" submitLabel="Submit review" className="space-y-3">
                  <fieldset>
                    <legend className="text-[13px] font-medium text-ink">Rating</legend>
                    <div className="mt-1 flex gap-3 text-[14px]">
                      {[5, 4, 3, 2, 1].map((n) => (
                        <label key={n} className="flex items-center gap-1"><input type="radio" name="rating" value={n} required defaultChecked={n === 5} className="accent-ink" /> {n}★</label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block text-[13px]">Name shown<input name="author_name" defaultValue={defaultName} required maxLength={60} className={input} /></label>
                  <label className="block text-[13px]">Title (optional)<input name="title" maxLength={120} className={input} /></label>
                  <label className="block text-[13px]">Your review<textarea name="body" required minLength={10} maxLength={2000} rows={4} className={input} /></label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-[13px]">Size bought<select name="size" className={input} defaultValue=""><option value="">Rather not say</option>{sizes.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                    <label className="block text-[13px]">Fit<select name="fit" className={input} defaultValue=""><option value="">Rather not say</option><option value="true">True to size</option><option value="small">Runs small</option><option value="large">Runs large</option></select></label>
                  </div>
                  <p className="text-[12px] text-neutral-500">Reviews are checked by our team before they appear.</p>
                </ActionForm>
              </div>
            </details>
          ) : (
            <Link href={`/account/login?next=${encodeURIComponent(`/product/${slug}#reviews`)}`} className="inline-block border border-ink px-4 py-2 text-[14px] text-ink hover:bg-ink hover:text-white">Sign in to write a review</Link>
          )}
        </div>
      </div>
      <ul className="divide-y divide-neutral-300 border-y border-neutral-300">
        {data.reviews.map((r) => (
          <li key={r.id} className="py-5 text-[14px]">
            <div className="flex flex-wrap items-center gap-3">
              <Stars rating={r.rating} />
              {r.title ? <strong className="font-medium text-ink">{r.title}</strong> : null}
              {r.verified_purchase ? <span className="text-[12px] text-green-700">Verified purchase</span> : null}
            </div>
            <p className="mt-2 whitespace-pre-line text-neutral-700">{r.body}</p>
            <p className="mt-2 text-[12px] text-neutral-500">
              {r.author_name}{r.author_city ? `, ${r.author_city}` : ""} · {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              {r.size_bought ? ` · Size ${r.size_bought}` : ""}{r.fit ? ` · ${FIT_LABEL[r.fit]}` : ""}
            </p>
            {r.staff_reply ? <p className="mt-3 border-l-2 border-neutral-300 pl-3 text-neutral-600"><span className="font-medium text-ink">Reply from the store: </span>{r.staff_reply}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
