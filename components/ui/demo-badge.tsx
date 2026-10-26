export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border border-bronze/40 bg-cream px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-bronze-strong ${className}`}
      title="Demonstration product for development. Not a real listing."
    >
      Demo product
    </span>
  );
}
