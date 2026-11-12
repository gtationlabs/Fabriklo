import type { Permission } from "@/lib/auth/permissions";

export type SettingsNavIcon =
  | "profile" | "account" | "security" | "store" | "invoice" | "appearance" | "notifications" | "social" | "campaigns"
  | "whatsapp" | "automations" | "integrations" | "pixels" | "api";

export type SettingsNavItem = { href: string; label: string; icon: SettingsNavIcon; group: string; permission: Permission | null; keywords: string; badge?: string };

/** Settings hub sections. Some link into existing admin pages instead of duplicating them. */
export const SETTINGS_NAV: SettingsNavItem[] = [
  { href: "/admin/settings/profile", label: "Profile", icon: "profile", group: "Account", permission: null, keywords: "name avatar photo picture job title phone language" },
  { href: "/admin/settings/account", label: "Account", icon: "account", group: "Account", permission: null, keywords: "email password role permissions" },
  { href: "/admin/settings/security", label: "Security", icon: "security", group: "Account", permission: null, keywords: "mfa two factor authenticator sessions sign out activity" },
  { href: "/admin/settings/store", label: "Store details", icon: "store", group: "Store", permission: "settings.manage", keywords: "name brand tagline locale contact email phone address hours" },
  { href: "/admin/settings/invoice", label: "Invoice & packing slip", icon: "invoice", group: "Store", permission: "settings.manage", keywords: "receipt invoice packing slip bin vat print return policy" },
  { href: "/admin/content/theme", label: "Appearance", icon: "appearance", group: "Store", permission: "cms.edit", keywords: "theme colours colors fonts look" },
  { href: "/admin/settings/notifications", label: "Notifications", icon: "notifications", group: "Store", permission: "marketing.read", keywords: "email sms whatsapp templates outbox order confirmation" },
  { href: "/admin/settings/social", label: "Social profiles", icon: "social", group: "Marketing", permission: "settings.manage", keywords: "facebook instagram tiktok youtube whatsapp links footer" },
  { href: "/admin/marketing/campaigns", label: "Campaigns", icon: "campaigns", group: "Marketing", permission: "marketing.read", keywords: "campaign broadcast newsletter segment" },
  { href: "/admin/marketing/rules", label: "Automations", icon: "automations", group: "Marketing", permission: "marketing.read", keywords: "automation rules abandoned cart webhook" },
  { href: "/admin/marketing/integrations", label: "Integrations", icon: "integrations", group: "Integrations", permission: "integrations.read", keywords: "smtp sms whatsapp ga4 google analytics providers" },
  { href: "/admin/settings/meta-pixels", label: "Meta Pixels & Datasets", icon: "pixels", group: "Integrations", permission: "integrations.read", keywords: "facebook pixel meta dataset tracking ads" },
  { href: "/admin/settings/api", label: "API & Webhooks", icon: "api", group: "Integrations", permission: "integrations.read", keywords: "api key token webhook developer" },
];

export function visibleSettingsNav(perms: readonly string[]) {
  return SETTINGS_NAV.filter((i) => i.permission === null || perms.includes(i.permission));
}
