// Scenario 3: admin console under load, with a real staff session.
// Sign in through the browser first (MFA), then copy the Supabase auth cookie
// header value into ADMIN_COOKIE. No credentials are stored in this file.
//   ADMIN_COOKIE='sb-...-auth-token=...' k6 run load/k6/admin.js
import { sleep } from "k6";
import { get, ok, thresholds } from "./lib.js";

export const options = {
  scenarios: { admin: { executor: "constant-vus", vus: Number(__ENV.VUS || 3), duration: __ENV.DURATION || "3m" } },
  thresholds: { ...thresholds, "http_req_duration{kind:page}": ["p(95)<1500"] },
};

const PAGES = ["/admin", "/admin/orders", "/admin/products", "/admin/inventory", "/admin/risk", "/admin/audit"];

export default function admin() {
  if (!__ENV.ADMIN_COOKIE) throw new Error("ADMIN_COOKIE is required");
  for (const p of PAGES) {
    const res = get(p, { headers: { Cookie: __ENV.ADMIN_COOKIE }, tags: { kind: "page" }, redirects: 0 });
    ok(res, p);
    sleep(0.5);
  }
  sleep(2);
}
