import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { automationStatus, daysBetween } from "./lib/validators";

export function reminderKey(loanId: string, date: string): string {
  return `overdue-reminder:${loanId}:${date}`;
}

// Approved loans whose end date has passed, minus any loan that already got a
// successful reminder today. A rerun of the daily workflow therefore re-sends nothing.
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .collect();

    const result = [];
    for (const loan of loans) {
      const existing = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", reminderKey(loan._id, today)))
        .unique();
      if (existing?.status === "sent") continue;

      const borrower = await ctx.db.get(loan.borrowerId);
      const tool = await ctx.db.get(loan.toolId);
      if (borrower === null) continue;
      result.push({
        loanId: loan._id,
        toolName: tool?.name ?? "a borrowed tool",
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { email: borrower.email, firstName: borrower.firstName },
      });
    }
    return result;
  },
});

// Idempotent write-back for one reminder: one row per loan per day, however many
// times n8n retries. A later "sent" upgrades an earlier "failed"; nothing downgrades "sent".
export const recordReminder = internalMutation({
  args: {
    loanId: v.string(),
    date: v.string(),
    status: automationStatus,
    detail: v.optional(v.string()),
    executionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (loanId === null) return { ok: false as const, error: "unknown loan" };
    const loan = await ctx.db.get(loanId);
    if (loan === null) return { ok: false as const, error: "unknown loan" };

    const idempotencyKey = reminderKey(loanId, args.date);
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();

    if (existing !== null) {
      if (existing.status === "failed" && args.status === "sent") {
        await ctx.db.patch(existing._id, {
          status: "sent",
          detail: args.detail,
          executionId: args.executionId,
        });
        return { ok: true as const, duplicate: false, id: existing._id };
      }
      return { ok: true as const, duplicate: true, id: existing._id };
    }

    const id = await ctx.db.insert("automationEvents", {
      idempotencyKey,
      loanId,
      kind: "overdue_reminder",
      status: args.status,
      detail: args.detail?.slice(0, 300),
      executionId: args.executionId,
    });
    return { ok: true as const, duplicate: false, id };
  },
});

export const recordWorkflowError = internalMutation({
  args: {
    executionId: v.string(),
    workflowName: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workflowErrors")
      .withIndex("by_execution", (q) => q.eq("executionId", args.executionId))
      .unique();
    if (existing !== null) return { duplicate: true };
    await ctx.db.insert("workflowErrors", {
      executionId: args.executionId.slice(0, 100),
      workflowName: args.workflowName.slice(0, 200),
      node: args.node?.slice(0, 200),
      message: args.message.slice(0, 1000),
    });
    return { duplicate: false };
  },
});
