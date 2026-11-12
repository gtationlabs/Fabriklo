/** Permission codes mirrored from supabase/migrations (public.permissions). */
export const PERMISSIONS = [
  "analytics.read",
  "analytics.export",
  "products.read",
  "products.write",
  "products.costs",
  "inventory.read",
  "inventory.adjust",
  "inventory.approve_large",
  "orders.read",
  "orders.fulfill",
  "orders.refund",
  "orders.cancel",
  "risk.review",
  "customers.read",
  "customers.manage",
  "cms.edit",
  "cms.publish",
  "theme.publish",
  "marketing.manage",
  "marketing.read",
  "automation.manage",
  "integrations.manage",
  "integrations.read",
  "settings.manage",
  "settings.security",
  "staff.manage",
  "audit.read",
  "tryon.manage",
  "reviews.moderate",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type AdminNavIcon =
  | "dashboard" | "products" | "categories" | "inventory" | "orders" | "leads" | "risk" | "slider" | "content"
  | "reviews" | "tryon" | "coupons" | "marketing" | "zones" | "methods" | "courier" | "payments" | "users"
  | "staff" | "audit" | "settings";

export type AdminNavItem = { href: string; label: string; permission: Permission | null; ready: boolean; icon: AdminNavIcon; group: string };

/** Role-filtered navigation. Hiding a link is cosmetic; the server re-checks. */
export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", permission: null, ready: true, icon: "dashboard", group: "Store" },
  { href: "/admin/products", label: "Products", permission: "products.read", ready: true, icon: "products", group: "Store" },
  { href: "/admin/categories", label: "Categories", permission: "products.read", ready: true, icon: "categories", group: "Store" },
  { href: "/admin/inventory", label: "Inventory", permission: "inventory.read", ready: true, icon: "inventory", group: "Store" },
  { href: "/admin/orders", label: "Orders", permission: "orders.read", ready: true, icon: "orders", group: "Store" },
  { href: "/admin/checkout-leads", label: "Checkout Leads", permission: "orders.read", ready: true, icon: "leads", group: "Store" },
  { href: "/admin/risk", label: "Risk review", permission: "risk.review", ready: true, icon: "risk", group: "Store" },
  { href: "/admin/slider", label: "Slider", permission: "cms.edit", ready: true, icon: "slider", group: "Storefront" },
  { href: "/admin/content", label: "Content & hero", permission: "cms.edit", ready: true, icon: "content", group: "Storefront" },
  { href: "/admin/reviews", label: "Reviews", permission: "reviews.moderate", ready: true, icon: "reviews", group: "Storefront" },
  { href: "/admin/tryon", label: "AI try-on", permission: "tryon.manage", ready: true, icon: "tryon", group: "Storefront" },
  { href: "/admin/marketing/coupons", label: "Coupons", permission: "marketing.read", ready: true, icon: "coupons", group: "Sales & delivery" },
  { href: "/admin/marketing", label: "Marketing", permission: "marketing.read", ready: true, icon: "marketing", group: "Sales & delivery" },
  { href: "/admin/shipping-zones", label: "Shipping Zones", permission: "settings.manage", ready: true, icon: "zones", group: "Sales & delivery" },
  { href: "/admin/shipping-methods", label: "Shipping Methods", permission: "settings.manage", ready: true, icon: "methods", group: "Sales & delivery" },
  { href: "/admin/courier", label: "Courier", permission: "settings.manage", ready: true, icon: "courier", group: "Sales & delivery" },
  { href: "/admin/payment-methods", label: "Payment Methods", permission: "settings.manage", ready: true, icon: "payments", group: "Sales & delivery" },
  { href: "/admin/users", label: "Users", permission: "customers.read", ready: true, icon: "users", group: "People" },
  { href: "/admin/staff", label: "Staff", permission: "staff.manage", ready: true, icon: "staff", group: "People" },
  { href: "/admin/audit", label: "Audit log", permission: "audit.read", ready: true, icon: "audit", group: "People" },
  { href: "/admin/settings", label: "Settings", permission: null, ready: true, icon: "settings", group: "People" },
];

export function visibleNav(perms: readonly string[]) {
  return ADMIN_NAV.filter((i) => i.permission === null || perms.includes(i.permission));
}
