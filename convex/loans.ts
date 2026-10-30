import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getCurrentUser, requireUser } from "./lib/auth";
import { fail, optionalText } from "./lib/errors";
import { approvedLoans, loanActivity } from "./lib/loans";
import {
  addDays,
  daysBetween,
  isIsoDate,
  LIMITS,
  rangesOverlap,
  todayUtc,
} from "./lib/validators";
import { enqueueNotification } from "./notifications";

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (tool === null || tool.removedAt !== undefined) fail("NOT_FOUND", "Listing not found.");
    if (tool.ownerId === me._id) fail("INVALID_INPUT", "You cannot borrow your own tool.");

    const range = validateRange(args.startDate, args.endDate);

    const booked = await approvedLoans(ctx, tool._id);
    if (booked.some((loan) => rangesOverlap(loan, range))) {
      fail("CONFLICT", "This tool is already booked for some of those dates.");
    }

    const mine = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .collect();
    const open = mine.filter((loan) => loan.status === "pending");
    if (open.some((loan) => loan.toolId === tool._id && rangesOverlap(loan, range))) {
      fail("CONFLICT", "You already have a pending request for these dates.");
    }
    if (open.length >= LIMITS.maxOpenRequestsPerBorrower) {
      fail("CONFLICT", "You have too many pending requests. Wait for some answers first.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate: range.startDate,
      endDate: range.endDate,
      status: "pending",
      note: optionalText(args.note, "Note", LIMITS.noteMax),
    });
    await enqueueNotification(ctx, loanId, tool.ownerId, "loan.requested");
    return loanId;
  },
});

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await loadAsLender(ctx, loanId);
    if (loan.status !== "pending") fail("CONFLICT", "Only pending requests can be approved.");
    if (loan.endDate < todayUtc()) fail("CONFLICT", "This request's dates have already passed.");

    // Mutations are serializable, so this check and the write below cannot race
    // with a second approval for the same dates.
    const booked = await approvedLoans(ctx, loan.toolId);
    if (booked.some((other) => rangesOverlap(other, loan))) {
      fail("CONFLICT", "You already approved another request for these dates.");
    }

    await ctx.db.patch(loan._id, { status: "approved", decidedAt: Date.now() });
    await enqueueNotification(ctx, loan._id, loan.borrowerId, "loan.approved");

    // Any other pending request that overlaps can no longer be honored.
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "pending"))
      .collect();
    for (const other of pending) {
      if (other._id !== loan._id && rangesOverlap(other, loan)) {
        await ctx.db.patch(other._id, {
          status: "declined",
          decidedAt: Date.now(),
          closedReason: "Dates were booked by another request",
        });
        await enqueueNotification(ctx, other._id, other.borrowerId, "loan.declined");
      }
    }
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await loadAsLender(ctx, loanId);
    if (loan.status !== "pending") fail("CONFLICT", "Only pending requests can be declined.");
    await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now() });
    await enqueueNotification(ctx, loan._id, loan.borrowerId, "loan.declined");
  },
});

// The lender confirms the tool came back, so only the lender can close the loan.
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await loadAsLender(ctx, loanId);
    if (loan.status !== "approved") fail("CONFLICT", "Only active loans can be marked returned.");
    if (loan.startDate > todayUtc()) {
      fail("CONFLICT", "This loan has not started yet. Decline or let the borrower cancel instead.");
    }
    await ctx.db.patch(loan._id, { status: "returned", returnedAt: Date.now() });
    await enqueueNotification(ctx, loan._id, loan.borrowerId, "loan.returned");
  },
});

export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (loan === null || loan.borrowerId !== me._id) fail("NOT_FOUND", "Request not found.");
    if (loan.status !== "pending") fail("CONFLICT", "Only pending requests can be cancelled.");
    await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
    await enqueueNotification(ctx, loan._id, loan.ownerId, "loan.cancelled");
  },
});

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (me === null) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((loan) => describeLoan(ctx, loan, "borrower")));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (me === null) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((loan) => describeLoan(ctx, loan, "lender")));
  },
});

// Loads a loan and checks that the caller lends the tool. A loan that belongs to
// someone else reads as "not found", so ids cannot be probed.
async function loadAsLender(ctx: MutationCtx, loanId: Id<"loans">) {
  const me = await requireUser(ctx);
  const loan = await ctx.db.get(loanId);
  if (loan === null || loan.ownerId !== me._id) fail("NOT_FOUND", "Request not found.");
  return { me, loan };
}

function validateRange(startDate: string, endDate: string) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    fail("INVALID_INPUT", "Dates must be valid calendar dates.");
  }
  const today = todayUtc();
  if (startDate < today) fail("INVALID_INPUT", "The start date cannot be in the past.");
  if (endDate < startDate) fail("INVALID_INPUT", "The end date must be on or after the start date.");
  if (startDate > addDays(today, LIMITS.maxDaysAhead)) {
    fail("INVALID_INPUT", `Requests can start at most ${LIMITS.maxDaysAhead} days ahead.`);
  }
  if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
    fail("INVALID_INPUT", `A loan can last at most ${LIMITS.maxLoanDays} days.`);
  }
  return { startDate, endDate };
}

async function describeLoan(ctx: QueryCtx, loan: Doc<"loans">, viewer: "borrower" | "lender") {
  const tool = await ctx.db.get(loan.toolId);
  const other = await ctx.db.get(viewer === "borrower" ? loan.ownerId : loan.borrowerId);
  const today = todayUtc();
  return {
    _id: loan._id,
    createdAt: loan._creationTime,
    toolName: tool?.name ?? "Removed tool",
    toolRemoved: tool?.removedAt !== undefined,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < today,
    started: loan.startDate <= today,
    note: loan.note,
    closedReason: loan.closedReason,
    counterpart: {
      firstName: other?.firstName ?? "Neighbor",
      trustedLender: viewer === "borrower" ? (other?.trustedLender ?? false) : false,
    },
    activity: await loanActivity(ctx, loan._id),
  };
}
