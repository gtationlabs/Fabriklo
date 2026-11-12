import type { ShareLink } from "@/lib/catalog/product-page";

/** Outline marks for the share row: drawn here so no third-party script or font is loaded. */
export function ShareIcon({ network, className = "" }: { network: ShareLink["network"]; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className };
  switch (network) {
    case "facebook":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M13.2 21.8V13.6h2.6l.4-3h-3V8.8c0-.9.3-1.5 1.5-1.5h1.6V4.6a20 20 0 0 0-2.3-.1c-2.3 0-3.8 1.4-3.8 3.9v2.2H7.6v3h2.6v8.2" />
        </svg>
      );
    case "messenger":
      return (
        <svg {...common}>
          <path d="M12 2.5c-5.4 0-9.5 3.9-9.5 9 0 2.7 1.1 5 3 6.6v3.4l3.2-1.8c1 .3 2.1.5 3.3.5 5.4 0 9.5-3.9 9.5-8.7S17.4 2.5 12 2.5Z" />
          <path d="m6.8 14.2 3.3-3.6 2.4 2 3.4-3.6-2.9 4-2.6-2-3.6 3.2Z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...common}>
          <path d="M3.5 20.5 4.8 16A9 9 0 1 1 8 19.3l-4.5 1.2Z" />
          <path d="M9 8.2c.2-.4.5-.5.8-.5h.5l.9 2.1-.6.8c.5 1 1.4 1.9 2.4 2.4l.8-.6 2.1.9v.5c0 .3-.1.6-.5.8-.6.4-1.4.5-2.2.2a8.3 8.3 0 0 1-4.5-4.5c-.3-.8-.2-1.6.3-2.1Z" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M4 4h4.6l11.4 16h-4.6L4 4Z" />
          <path d="M19.6 4 13.4 11M10.6 13 4.4 20" />
        </svg>
      );
  }
}
