import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { audit, requireAdmin } from "./lib/auth";
import { fail } from "./lib/errors";
import { todayUtc } from "./lib/validators";

export const allLoans = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const today = todayUtc();
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return await Promise.all(
      loans.map(async (loan) => {
        const [tool, owner, borrower] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.ownerId),
          ctx.db.get(loan.borrowerId),
        ]);
        return {
          _id: loan._id,
          toolName: tool?.name ?? "Removed tool",
          lender: owner?.firstName ?? "Unknown",
          borrower: borrower?.firstName ?? "Unknown",
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
          overdue: loan.status === "approved" && loan.endDate < today,
        };
      }),
    );
  },
});

// Users who have listed at least one tool, for the Trusted Lender toggle.
export const lenders = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const tools = await ctx.db.query("tools").collect();
    const counts = new Map<Id<"users">, number>();
    for (const tool of tools) {
      if (tool.removedAt !== undefined) continue;
      counts.set(tool.ownerId, (counts.get(tool.ownerId) ?? 0) + 1);
    }
    const rows = [];
    for (const [ownerId, listings] of counts) {
      const user = await ctx.db.get(ownerId);
      if (user === null) continue;
      rows.push({
        _id: user._id,
        firstName: user.firstName,
        email: user.email,
        trustedLender: user.trustedLender,
        listings,
      });
    }
    return rows.sort((a, b) => a.firstName.localeCompare(b.firstName));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const admin = await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (user === null) fail("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
    await audit(ctx, admin, trusted ? "lender.trusted" : "lender.untrusted", userId);
  },
});

export const listings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const tools = await ctx.db.query("tools").order("desc").take(200);
    return await Promise.all(
      tools
        .filter((tool) => tool.removedAt === undefined)
        .map(async (tool) => {
          const owner = await ctx.db.get(tool.ownerId);
          return {
            _id: tool._id,
            name: tool.name,
            category: tool.category,
            owner: owner?.firstName ?? "Unknown",
          };
        }),
    );
  },
});

// Everything an operator needs to see that automation is failing.
export const automationHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const notifications = await ctx.db.query("notifications").order("desc").take(200);
    const failedNotifications = notifications
      .filter((n) => n.status === "failed" || n.status === "skipped")
      .slice(0, 20)
      .map((n) => ({
        _id: n._id,
        type: n.type,
        status: n.status,
        attempts: n.attempts,
        lastError: n.lastError,
        at: n._creationTime,
      }));
    const retrying = notifications.filter((n) => n.status === "pending" && n.attempts > 0).length;

    const workflowErrors = (await ctx.db.query("workflowErrors").order("desc").take(20)).map(
      (e) => ({
        _id: e._id,
        workflowName: e.workflowName,
        node: e.node,
        message: e.message,
        executionId: e.executionId,
        at: e._creationTime,
      }),
    );

    const reminders = await ctx.db.query("automationEvents").order("desc").take(20);
    return {
      retrying,
      failedNotifications,
      workflowErrors,
      recentReminders: reminders.map((r) => ({
        _id: r._id,
        status: r.status,
        detail: r.detail,
        at: r._creationTime,
      })),
    };
  },
});
