// Scenario 1: anonymous browsing. Home, shop listing, product pages, search.
// Expect this to be the bulk of real traffic; everything here should be cheap.
import { sleep } from "k6";
import { BASE_URL, get, ok, thresholds } from "./lib.js";

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "1m", target: 20 },
        { duration: "3m", target: 20 },
        { duration: "1m", target: 60 },
        { duration: "2m", target: 60 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds,
};

export function setup() {
  // Discover product slugs from the JSON listing so the script stays data-driven.
  const res = get("/api/products?limit=24", { tags: { kind: "api" } });
  const body = res.json();
  const slugs = (body?.products || []).map((p) => p.slug).filter(Boolean);
  if (!slugs.length) throw new Error(`no products from ${BASE_URL}/api/products`);
  return { slugs };
}

export default function browse({ slugs }) {
  ok(get("/", { tags: { kind: "page" } }), "home");
  sleep(1 + Math.random());
  ok(get("/shop", { tags: { kind: "page" } }), "shop");
  sleep(1);
  ok(get("/api/products?sort=newest&limit=24", { tags: { kind: "api" } }), "products api");
  const slug = slugs[Math.floor(Math.random() * slugs.length)];
  ok(get(`/products/${slug}`, { tags: { kind: "page", name: "/products/[slug]" } }), "product");
  sleep(2 + Math.random() * 2);
  ok(get("/search?q=shirt", { tags: { kind: "page" } }), "search");
  sleep(1);
}
