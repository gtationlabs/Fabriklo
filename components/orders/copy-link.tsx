"use client";

import { useState } from "react";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        aria-label="Tracking link"
        data-testid="tracking-link"
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded border border-line bg-paper px-3 py-2 text-xs"
      />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
        className="rounded bg-espresso px-3 py-2 text-sm text-cream"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      <span role="status" className="sr-only">{copied ? "Link copied" : ""}</span>
    </div>
  );
}
