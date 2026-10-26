// Scenario 2: cart + checkout quote. Adds a variant to a fresh guest cart and
// asks for a delivery quote. It stops short of placing orders so it can run
// against staging without creating junk orders; set PLACE_ORDERS=1 to go all
// the way (COD, against a scratch database only; orders are real rows).
//
// Rate limits are per IP (cart 60/min, quote 60/min, orders 8/10min): running
// from one machine will hit them at modest VU counts, which is itself a useful
// check. Use a distributed run (k6 cloud / several agents) for true load.
import { check, sleep } from "k6";
import { get, ok, postJson, thresholds } from "./lib.js";

export const options = {
  scenarios: {
    checkout: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 5), // new shoppers per minute
      timeUnit: "1m",
      duration: __ENV.DURATION || "5m",
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
  },
  thresholds: {
    ...thresholds,
    "http_req_duration{name:/api/checkout/quote}": ["p(95)<600"],
  },
};

export function setup() {
  // The public listing does not expose variant ids; pass in-stock variant ids:
  //   VARIANT_IDS=$(psql "$DATABASE_URL" -tAc "select string_agg(v.id::text, ',') from public.product_variants v join public.stock_balances s on s.variant_id = v.id where s.on_hand - s.reserved > 5 limit 20")
  const variants = (__ENV.VARIANT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!variants.length) throw new Error("VARIANT_IDS is required (comma-separated in-stock variant uuids)");
  return { variants };
}

export default function checkout({ variants }) {
  const variantId = variants[Math.floor(Math.random() * variants.length)];
  ok(get("/shop", { tags: { kind: "page" } }), "shop");
  sleep(1);
  // Each VU has its own cookie jar: this creates a fresh guest cart.
  ok(postJson("/api/cart/items", { variantId, quantity: 1, mode: "add" }, { tags: { kind: "api" } }), "add to cart");
  sleep(1);
  ok(get("/cart", { tags: { kind: "page" } }), "cart page");
  ok(get("/checkout", { tags: { kind: "page" } }), "checkout page");
  ok(postJson("/api/checkout/quote", { district: "Dhaka" }, { tags: { kind: "api" } }), "quote");
  if (__ENV.PLACE_ORDERS === "1") {
    const quote = postJson("/api/checkout/quote", { district: "Dhaka" }, { tags: { kind: "api" } }).json();
    const res = postJson(
      "/api/checkout/orders",
      {
        idempotencyKey: `k6-${__VU}-${__ITER}-${Date.now()}`,
        name: "Load Test",
        phone: "01712345678",
        district: "Dhaka",
        area: "Banani",
        addressLine: "House 1, Road 2 (k6 load test)",
        paymentMethod: "cod",
        expectedTotalMinor: quote.total_minor,
      },
      { tags: { kind: "api" } },
    );
    check(res, { "place order 201": (r) => r.status === 201 });
  }
  sleep(2);
}
