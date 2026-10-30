import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { todayUtc } from "./validators";

export type ToolStatus = "available" | "on_loan";

export async function approvedLoans(ctx: QueryCtx, toolId: Id<"tools">) {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

// A tool is on loan from the start date of an approved loan until the lender marks
// it returned. An approved loan past its end date is overdue, and still on loan.
export async function toolStatus(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  today: string = todayUtc(),
): Promise<ToolStatus> {
  const loans = await approvedLoans(ctx, toolId);
  return loans.some((loan) => loan.startDate <= today) ? "on_loan" : "available";
}

export type ActivityItem = { label: string; at: number; ok: boolean };

const NOTICE_LABELS: Record<Doc<"notifications">["type"], string> = {
  "loan.requested": "Lender notified of the request",
  "loan.approved": "Borrower notified of approval",
  "loan.declined": "Borrower notified of decline",
  "loan.cancelled": "Lender notified of cancellation",
  "loan.returned": "Borrower notified of return",
};

// Recent automation activity for one loan, newest first.
export async function loanActivity(ctx: QueryCtx, loanId: Id<"loans">): Promise<ActivityItem[]> {
  const notices = await ctx.db
    .query("notifications")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .collect();
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .collect();

  const items: ActivityItem[] = [];
  for (const n of notices) {
    if (n.status === "delivered") {
      items.push({ label: NOTICE_LABELS[n.type], at: n.deliveredAt ?? n._creationTime, ok: true });
    } else if (n.status === "failed") {
      items.push({
        label: `${NOTICE_LABELS[n.type]}: failed after ${n.attempts} attempts`,
        at: n._creationTime,
        ok: false,
      });
    } else if (n.status === "pending" && n.attempts > 0) {
      items.push({ label: `${NOTICE_LABELS[n.type]}: retrying`, at: n._creationTime, ok: false });
    }
  }
  for (const e of events) {
    items.push({
      label: e.status === "sent" ? "Overdue reminder sent" : "Overdue reminder failed",
      at: e._creationTime,
      ok: e.status === "sent",
    });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, 5);
}
