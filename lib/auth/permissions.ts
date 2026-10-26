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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type AdminNavItem = { href: string; label: string; permission: Permission | null; ready: boolean };

/** Role-filtered navigation. Hiding a link is cosmetic; the server re-checks. */
export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", permission: null, ready: true },
  { href: "/admin/products", label: "Products", permission: "products.read", ready: true },
  { href: "/admin/inventory", label: "Inventory", permission: "inventory.read", ready: true },
  { href: "/admin/orders", label: "Orders", permission: "orders.read", ready: false },
  { href: "/admin/risk", label: "Risk review", permission: "risk.review", ready: false },
  { href: "/admin/content", label: "Content & hero", permission: "cms.edit", ready: false },
  { href: "/admin/marketing", label: "Marketing", permission: "marketing.read", ready: false },
  { href: "/admin/staff", label: "Staff", permission: "staff.manage", ready: false },
  { href: "/admin/audit", label: "Audit log", permission: "audit.read", ready: false },
  { href: "/admin/settings", label: "Settings", permission: "settings.manage", ready: false },
];

export function visibleNav(perms: readonly string[]) {
  return ADMIN_NAV.filter((i) => i.permission === null || perms.includes(i.permission));
}
