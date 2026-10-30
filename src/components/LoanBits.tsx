import type { LoanStatus } from "@convex/lib/validators";
import { timeAgo } from "@/lib/format";
import { Badge } from "./ui";

export function LoanStatusBadge({ status, overdue }: { status: LoanStatus; overdue?: boolean }) {
  if (overdue) return <Badge tone="red">Overdue</Badge>;
  switch (status) {
    case "pending":
      return <Badge tone="amber">Pending</Badge>;
    case "approved":
      return <Badge tone="green">Approved</Badge>;
    case "declined":
      return <Badge>Declined</Badge>;
    case "cancelled":
      return <Badge>Cancelled</Badge>;
    case "returned":
      return <Badge tone="blue">Returned</Badge>;
  }
}

export function TrustedBadge() {
  return <Badge tone="blue">Trusted Lender</Badge>;
}

export function ActivityList({ items }: { items: { label: string; at: number; ok: boolean }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 border-t border-stone-100 pt-3">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-2 text-xs text-stone-500">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.ok ? "bg-emerald-500" : "bg-red-500"}`}
            aria-hidden
          />
          <span className={item.ok ? "" : "text-red-700"}>{item.label}</span>
          <span className="text-stone-400">· {timeAgo(item.at)}</span>
        </li>
      ))}
    </ul>
  );
}
