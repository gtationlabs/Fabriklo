"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Accessible tabs (WAI-ARIA tabs pattern, automatic activation). Panels are
 * rendered on the server and passed in; this only switches which one shows.
 */
export function CategoryTabs({ tabs }: { tabs: { key: string; label: string; panel: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight" ? (active === last ? 0 : active + 1)
      : e.key === "ArrowLeft" ? (active === 0 ? last : active - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
    refs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return (
    <div>
      <div role="tablist" aria-label="Product categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.key}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel-${t.key}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={onKeyDown}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${
              i === active ? "border-espresso bg-espresso text-cream" : "border-line bg-cream text-espresso hover:border-bronze"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.key}
          role="tabpanel"
          id={`${base}-panel-${t.key}`}
          aria-labelledby={`${base}-tab-${t.key}`}
          hidden={i !== active}
          className="mt-6"
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}
