"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Filter dropdowns are plain <details> elements (they work without
 * JavaScript). This adds the expected menu behaviour on top: a click outside
 * or Escape closes the open one.
 */
export function DropdownDismiss() {
  useEffect(() => {
    const openMenus = () => document.querySelectorAll<HTMLDetailsElement>("details[data-dropdown][open]");
    function onPointer(e: PointerEvent) {
      for (const d of openMenus()) if (!d.contains(e.target as Node)) d.open = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      for (const d of openMenus()) {
        d.open = false;
        d.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}

/**
 * Sticky filter bar. While it is pinned under the site header it swaps the
 * breadcrumb for the item count (data-stuck drives the CSS).
 */
export function StickyBar({ className = "", children }: { className?: string; children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    // The site header is 64px tall and sticky, so the bar pins at that line.
    const io = new IntersectionObserver(([entry]) => setStuck(!entry!.isIntersecting), { rootMargin: "-65px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <div data-stuck={stuck ? "true" : "false"} className={`group/bar ${className}`}>
        {children}
      </div>
    </>
  );
}
