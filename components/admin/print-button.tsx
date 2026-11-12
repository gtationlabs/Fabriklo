"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-espresso px-4 py-2 text-sm font-medium text-cream">
      <Printer className="size-4" aria-hidden /> Print
    </button>
  );
}
