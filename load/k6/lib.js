// Shared helpers for the k6 scenarios. Run with:
//   BASE_URL=https://staging.example k6 run load/k6/browse.js
import http from "k6/http";
import { check } from "k6";

export const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

// Same-origin check on the API routes: send the Origin header a browser would.
export const jsonHeaders = {
  "Content-Type": "application/json",
  Origin: BASE_URL,
};

export function get(path, params = {}) {
  return http.get(`${BASE_URL}${path}`, { tags: { name: path.split("?")[0] }, ...params });
}

export function postJson(path, body, params = {}) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers: jsonHeaders, tags: { name: path }, ...params });
}

export function ok(res, label, status = 200) {
  return check(res, { [`${label} ${status}`]: (r) => r.status === status });
}

/** Default SLOs: p95 under 800 ms for pages, 400 ms for JSON, <1% errors. */
export const thresholds = {
  http_req_failed: ["rate<0.01"],
  "http_req_duration{kind:page}": ["p(95)<800"],
  "http_req_duration{kind:api}": ["p(95)<400"],
};
