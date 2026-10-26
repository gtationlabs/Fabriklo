import { label } from "@/lib/orders/labels";

const TONES: Record<string, string> = {
  cancelled: "bg-danger/10 text-danger",
  rejected_with_reason: "bg-danger/10 text-danger",
  blocked_by_policy: "bg-danger/10 text-danger",
  delivery_failed: "bg-danger/10 text-danger",
  rto: "bg-danger/10 text-danger",
  needs_review: "bg-bronze/15 text-bronze-strong",
  delivered: "bg-success/10 text-success",
  cod_collected: "bg-success/10 text-success",
  paid: "bg-success/10 text-success",
  approved: "bg-success/10 text-success",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${TONES[status] ?? "bg-sand text-espresso"}`}>
      {label(status)}
    </span>
  );
}
