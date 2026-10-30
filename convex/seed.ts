import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { fail } from "./lib/errors";
import { addDays, todayUtc } from "./lib/validators";

// Demo helper, not callable from clients. Creates an approved loan that ended in the
// past, so the overdue-reminder workflow has something to do right away:
//   npx convex run seed:overdueLoan '{"lenderEmail":"a@example.com","borrowerEmail":"b@example.com"}'
export const overdueLoan = internalMutation({
  args: {
    lenderEmail: v.string(),
    borrowerEmail: v.string(),
    daysOverdue: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const byEmail = (email: string) =>
      ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
        .unique();
    const lender = await byEmail(args.lenderEmail);
    const borrower = await byEmail(args.borrowerEmail);
    if (lender === null || borrower === null) {
      fail("NOT_FOUND", "Both users must sign in to the app once before seeding.");
    }

    const daysOverdue = Math.max(1, Math.floor(args.daysOverdue ?? 2));
    const endDate = addDays(todayUtc(), -daysOverdue);
    const toolId = await ctx.db.insert("tools", {
      ownerId: lender._id,
      name: "Pressure washer",
      category: "cleaning",
      condition: "good",
      description: "Seeded for the overdue reminder demo.",
    });
    return await ctx.db.insert("loans", {
      toolId,
      ownerId: lender._id,
      borrowerId: borrower._id,
      startDate: addDays(endDate, -3),
      endDate,
      status: "approved",
      decidedAt: Date.now(),
    });
  },
});
