/**
 * Demo accounts for testing the storefront and the admin dashboard.
 *
 * DEV / SANDBOX ONLY. The password is public (it's in the README), so these
 * accounts must never exist in a production project. Remove them with
 * `npm run seed:demo-users -- --remove`.
 */
export const DEMO_EMAIL_DOMAIN = "demo.fabriklo.local";
export const DEFAULT_DEMO_PASSWORD = "Fabriklo-Demo-2026!";
export const DEMO_SECRETS_FILE = ".demo-users.local.json";

export type DemoAccount = {
  key: "owner" | "admin" | "manager" | "staff" | "customer";
  email: string;
  name: string;
  /** staff_roles.code, or null for a storefront customer. */
  role: string | null;
  /** Used when `role` is missing from the database (migration not applied yet). */
  fallbackRole?: string;
  loginPath: string;
  summary: string;
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    key: "owner",
    email: `owner@${DEMO_EMAIL_DOMAIN}`,
    name: "Demo Owner",
    role: "super_admin",
    loginPath: "/admin/login",
    summary: "Everything, including security settings, integrations and super-admin assignment",
  },
  {
    key: "admin",
    email: `admin@${DEMO_EMAIL_DOMAIN}`,
    name: "Demo Admin",
    role: "admin",
    loginPath: "/admin/login",
    summary: "Runs the whole store; cannot change security settings or integration secrets",
  },
  {
    key: "manager",
    email: `manager@${DEMO_EMAIL_DOMAIN}`,
    name: "Demo Manager",
    role: "store_manager",
    fallbackRole: "order_manager",
    loginPath: "/admin/login",
    summary: "Day-to-day operations: products, stock, orders, risk, customers; no staff or settings",
  },
  {
    key: "staff",
    email: `staff@${DEMO_EMAIL_DOMAIN}`,
    name: "Demo Staff",
    role: "support_agent",
    loginPath: "/admin/login",
    summary: "Front-line staff: read orders, customers and products only",
  },
  {
    key: "customer",
    email: `customer@${DEMO_EMAIL_DOMAIN}`,
    name: "Demo Customer",
    role: null,
    loginPath: "/account/login",
    summary: "Storefront shopper with a saved Dhaka address; no admin access",
  },
];

export const DEMO_CUSTOMER_PHONE = "+8801700000001";
