"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Cart } from "@/lib/cart/types";
import { formatBDT } from "@/lib/money";
import { DemoBadge } from "@/components/ui/demo-badge";

export function CartLines({ cart }: { cart: Cart }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function update(variantId: string, quantity: number) {
    setError(null);
    const res = await fetch("/api/cart/items", {
      method: quantity === 0 ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quantity === 0 ? { variantId } : { variantId, quantity, mode: "set" }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error?.message ?? "Could not update your cart.");
    }
    startTransition(() => router.refresh());
  }

  return (
    <div aria-busy={pending}>
      {error ? (
        <p role="alert" className="mb-4 rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-line border-y border-line">
        {cart.items.map((item) => (
          <li key={item.variant_id} className="flex flex-wrap items-center gap-4 py-5" data-testid="cart-line">
            <span className="h-16 w-14 shrink-0 rounded-sm" style={{ backgroundColor: item.color_hex ?? "#ccc" }} aria-hidden />
            <div className="min-w-0 flex-1">
              <Link href={`/product/${item.slug}`} className="font-medium text-espresso hover:underline">
                {item.title}
              </Link>
              <p className="text-sm text-muted">
                {item.color} · {item.size} · SKU {item.sku}
              </p>
              {item.is_demo ? <DemoBadge className="mt-1" /> : null}
              {!item.purchasable ? <p className="text-sm text-danger">No longer available</p> : null}
              {item.purchasable && item.available < item.quantity ? (
                <p className="text-sm text-danger">Only {item.available} left: please reduce the quantity.</p>
              ) : null}
            </div>
            <label className="text-sm">
              <span className="sr-only">Quantity for {item.title}</span>
              <select
                value={item.quantity}
                disabled={pending}
                onChange={(e) => update(item.variant_id, Number(e.target.value))}
                className="rounded border border-line bg-white px-2 py-1.5"
              >
                {Array.from({ length: Math.min(10, Math.max(item.quantity, item.available)) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <p className="w-24 text-right font-medium">{formatBDT(item.line_total_minor)}</p>
            <button
              type="button"
              onClick={() => update(item.variant_id, 0)}
              disabled={pending}
              className="text-sm text-muted underline hover:text-danger"
            >
              Remove<span className="sr-only"> {item.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
