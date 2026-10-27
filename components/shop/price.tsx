import { formatBDT } from "@/lib/money";

export function Price({
  minor,
  compareAtMinor,
  from = false,
  className = "",
}: {
  minor: number;
  compareAtMinor?: number | null;
  from?: boolean;
  className?: string;
}) {
  const onSale = compareAtMinor != null && compareAtMinor > minor;
  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span className={onSale ? "text-danger" : undefined}>
        {from ? <span className="sr-only">From </span> : null}
        {formatBDT(minor)}
      </span>
      {onSale ? (
        <s className="text-sm text-muted">
          <span className="sr-only">Was </span>
          {formatBDT(compareAtMinor)}
        </s>
      ) : null}
    </span>
  );
}
