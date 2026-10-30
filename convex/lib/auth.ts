import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

type Ctx = QueryCtx | MutationCtx;

// Every authorization decision starts here. The role comes from our own users
// table, never from the client or from a token claim the user could influence.
export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) fail("UNAUTHENTICATED", "Sign in to continue.");
  const user = await getCurrentUser(ctx);
  if (user === null) fail("UNAUTHENTICATED", "Your account is still being set up. Try again.");
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") fail("FORBIDDEN", "Admins only.");
  return user;
}

export function isOwnerOrAdmin(user: Doc<"users">, ownerId: Id<"users">): boolean {
  return user.role === "admin" || user._id === ownerId;
}

export async function audit(
  ctx: MutationCtx,
  actor: Doc<"users">,
  action: string,
  targetId: string,
  detail?: string,
): Promise<void> {
  await ctx.db.insert("auditLog", { actorId: actor._id, action, targetId, detail });
}
