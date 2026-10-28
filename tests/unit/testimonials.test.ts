import { describe, expect, it } from "vitest";
import { getHomeTestimonials, SAMPLE_TESTIMONIALS, summarizeReviews } from "@/lib/reviews/testimonials";

describe("summarizeReviews", () => {
  it("averages to one decimal and builds the 5→1 star distribution", () => {
    const s = summarizeReviews([
      { rating: 5, fit: "true" },
      { rating: 5, fit: "small" },
      { rating: 4, fit: "true" },
      { rating: 3, fit: "large" },
    ]);
    expect(s.average).toBe(4.3);
    expect(s.count).toBe(4);
    expect(s.distribution).toEqual([0.5, 0.25, 0.25, 0, 0]);
    expect(s.trueToSize).toBe(0.5);
  });

  it("handles no reviews without dividing by zero", () => {
    expect(summarizeReviews([])).toEqual({ average: 0, count: 0, distribution: [0, 0, 0, 0, 0], trueToSize: 0 });
  });
});

describe("home testimonials", () => {
  it("are flagged as samples and have unique ids, valid ratings and hex swatches", () => {
    const { reviews, sample } = getHomeTestimonials();
    expect(sample).toBe(true);
    expect(reviews.length).toBeGreaterThanOrEqual(5);
    expect(new Set(reviews.map((r) => r.id)).size).toBe(reviews.length);
    for (const r of SAMPLE_TESTIMONIALS) {
      expect(r.rating).toBeGreaterThanOrEqual(1);
      expect(r.rating).toBeLessThanOrEqual(5);
      expect(r.swatch).toMatch(/^#[0-9a-f]{6}$/i);
      expect(r.quote.length).toBeLessThan(60);
    }
  });
});
