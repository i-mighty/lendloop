import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { audit, getCurrentUser, isOwnerOrAdmin, requireUser } from "./lib/auth";
import { fail, requireText } from "./lib/errors";
import { toolStatus } from "./lib/loans";
import { category, condition, LIMITS, todayUtc } from "./lib/validators";
import { enqueueNotification } from "./notifications";

// Public, unauthenticated. Returns only name and category of tools that are
// available today: no ids, no owner, no description.
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const tools = await ctx.db.query("tools").collect();
    const result: { name: string; category: Doc<"tools">["category"] }[] = [];
    for (const tool of tools) {
      if (tool.removedAt !== undefined) continue;
      if ((await toolStatus(ctx, tool._id, today)) !== "available") continue;
      result.push({ name: tool.name, category: tool.category });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);
  },
});

export const list = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    if (me === null) return [];
    const today = todayUtc();

    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .collect()
      : await ctx.db.query("tools").collect();

    const myLoans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .collect();
    const requestedToolIds = new Set(
      myLoans.filter((l) => l.status === "pending").map((l) => l.toolId),
    );

    const rows = [];
    for (const tool of tools) {
      if (tool.removedAt !== undefined) continue;
      const owner = await ctx.db.get(tool.ownerId);
      rows.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        status: await toolStatus(ctx, tool._id, today),
        owner: { firstName: owner?.firstName ?? "Neighbor", trustedLender: owner?.trustedLender ?? false },
        isMine: tool.ownerId === me._id,
        requestedByMe: requestedToolIds.has(tool._id),
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (me === null) return [];
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .collect();
    const rows = [];
    for (const tool of tools) {
      if (tool.removedAt !== undefined) continue;
      const pending = await ctx.db
        .query("loans")
        .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
        .collect();
      rows.push({
        _id: tool._id,
        createdAt: tool._creationTime,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        status: await toolStatus(ctx, tool._id, today),
        pendingRequests: pending.length,
      });
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

const toolFields = {
  name: v.string(),
  category,
  condition,
  description: v.string(),
};

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name: requireText(args.name, "Name", LIMITS.nameMax),
      category: args.category,
      condition: args.condition,
      description: requireText(args.description, "Description", LIMITS.descriptionMax),
    });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (tool === null || tool.removedAt !== undefined) fail("NOT_FOUND", "Listing not found.");
    // Editing is owner-only. Admins can remove a listing, not rewrite it.
    if (tool.ownerId !== me._id) fail("FORBIDDEN", "You can only edit your own listings.");
    await ctx.db.patch(toolId, {
      name: requireText(args.name, "Name", LIMITS.nameMax),
      category: args.category,
      condition: args.condition,
      description: requireText(args.description, "Description", LIMITS.descriptionMax),
    });
  },
});

// Owners delete their own listings; admins can remove any listing. Soft delete, so
// loan history and any tool that is still out on loan stay intact.
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (tool === null || tool.removedAt !== undefined) fail("NOT_FOUND", "Listing not found.");
    if (!isOwnerOrAdmin(me, tool.ownerId)) {
      fail("FORBIDDEN", "You can only delete your own listings.");
    }

    await ctx.db.patch(toolId, { removedAt: Date.now(), removedBy: me._id });
    await closePendingRequests(ctx, tool, "Listing removed");
    if (tool.ownerId !== me._id) {
      await audit(ctx, me, "tool.removed_by_admin", toolId, tool.name);
    }
  },
});

async function closePendingRequests(ctx: MutationCtx, tool: Doc<"tools">, reason: string) {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
    .collect();
  for (const loan of pending) {
    await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now(), closedReason: reason });
    await enqueueNotification(ctx, loan._id, loan.borrowerId, "loan.declined");
  }
}
