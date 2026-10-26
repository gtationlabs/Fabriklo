"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatBDT } from "@/lib/money";
import { compareSizes } from "@/lib/catalog/sizes";

type Variant = {
  id: string;
  sku: string;
  size: string;
  color: string;
  color_hex: string | null;
  price_minor: number;
  compare_at_minor: number | null;
  available: number;
};

export function PurchasePanel({ variants }: { variants: Variant[] }) {
  const router = useRouter();
  const colors = useMemo(() => [...new Map(variants.map((v) => [v.color, v.color_hex])).entries()], [variants]);
  const [color, setColor] = useState(colors[0]?.[0] ?? "");
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const sizesForColor = variants.filter((v) => v.color === color).sort((a, b) => compareSizes(a.size, b.size));
  const selected = sizesForColor.find((v) => v.size === size) ?? null;
  const priceVariant = selected ?? sizesForColor[0] ?? variants[0];

  async function addToCart() {
    if (!selected) {
      setMessage({ tone: "error", text: "Please choose a size." });
      return;
    }
    setMessage(null);
    const res = await fetch("/api/cart/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: selected.id, quantity: qty, mode: "increment" }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ tone: "error", text: body?.error?.message ?? "Could not add to cart." });
      return;
    }
    setMessage({ tone: "ok", text: `Added ${qty} × ${selected.size} / ${selected.color} to your cart.` });
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      <p className="text-2xl text-espresso" data-testid="price">
        {formatBDT(priceVariant?.price_minor)}
        {priceVariant?.compare_at_minor ? (
          <s className="ml-3 text-base text-muted">
            <span className="sr-only">Was </span>
            {formatBDT(priceVariant.compare_at_minor)}
          </s>
        ) : null}
      </p>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-espresso">
          Colour: <span className="font-normal">{color}</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {colors.map(([name, hex]) => (
            <label key={name} className="cursor-pointer" title={name}>
              <input
                type="radio"
                name="color"
                value={name}
                checked={color === name}
                onChange={() => {
                  setColor(name);
                  setSize(null);
                  setMessage(null);
                }}
                className="peer sr-only"
              />
              <span className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm peer-checked:border-espresso peer-checked:ring-1 peer-checked:ring-espresso peer-focus-visible:outline-2 peer-focus-visible:outline-bronze">
                <span className="h-4 w-4 rounded-full border border-line" style={{ backgroundColor: hex ?? "#ccc" }} aria-hidden />
                {name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold text-espresso">
          <span>Size{size ? <span className="font-normal">: {size}</span> : null}</span>
          <Link href="/size-guide" className="font-normal text-bronze-strong underline">
            Size guide
          </Link>
        </legend>
        <div className="flex flex-wrap gap-2">
          {sizesForColor.map((v) => {
            const out = v.available <= 0;
            return (
              <label key={v.id} className={out ? "cursor-not-allowed" : "cursor-pointer"}>
                <input
                  type="radio"
                  name="size"
                  value={v.size}
                  checked={size === v.size}
                  disabled={out}
                  onChange={() => {
                    setSize(v.size);
                    setQty(1);
                    setMessage(null);
                  }}
                  className="peer sr-only"
                  aria-describedby={out ? `oos-${v.id}` : undefined}
                />
                <span
                  className={`inline-block min-w-12 rounded border px-3 py-2 text-center text-sm peer-checked:border-espresso peer-checked:bg-espresso peer-checked:text-cream peer-focus-visible:outline-2 peer-focus-visible:outline-bronze ${out ? "border-line text-muted line-through" : "border-line"}`}
                >
                  {v.size}
                </span>
                {out ? (
                  <span id={`oos-${v.id}`} className="sr-only">
                    sold out
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-muted" aria-live="polite" data-testid="availability">
          {selected
            ? selected.available > 5
              ? "In stock"
              : `Only ${selected.available} left`
            : sizesForColor.every((v) => v.available <= 0)
              ? "Sold out in this colour"
              : "Select a size to see availability"}
        </p>
      </fieldset>

      <div className="flex items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-espresso">Quantity</span>
          <select
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            disabled={!selected}
            className="rounded border border-line bg-white px-3 py-2"
          >
            {Array.from({ length: Math.min(10, Math.max(1, selected?.available ?? 1)) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={addToCart}
          disabled={pending || (selected !== null && selected.available <= 0)}
          className="flex-1 rounded bg-espresso px-6 py-3 font-medium text-cream hover:bg-charcoal disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add to cart"}
        </button>
      </div>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-danger" : "text-success"}`}>
          {message.text}{" "}
          {message.tone === "ok" ? (
            <Link href="/cart" className="underline">
              View cart
            </Link>
          ) : null}
        </p>
      ) : null}
      {selected ? <p className="text-xs text-muted">SKU {selected.sku}</p> : null}
    </div>
  );
}
