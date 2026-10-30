import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { fail } from "./lib/errors";
import { role } from "./lib/validators";

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Called by the client right after sign-in. Creates or refreshes the user row from
// the verified JWT. The client sends no arguments, so it cannot pick its own role.
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) fail("UNAUTHENTICATED", "Sign in to continue.");

    const email = identity.email?.toLowerCase();
    if (!email) fail("INVALID_INPUT", "Your account needs an email address.");
    const emailVerified = identity.emailVerified === true;
    const firstName = identity.givenName?.trim() || email.split("@")[0];

    const existing = await getCurrentUser(ctx);
    if (existing !== null) {
      if (
        existing.email !== email ||
        existing.firstName !== firstName ||
        existing.emailVerified !== emailVerified
      ) {
        await ctx.db.patch(existing._id, { email, firstName, emailVerified });
      }
      return existing._id;
    }

    // Admins are bootstrapped from a server-side allowlist, and only for a verified email.
    const isAdmin = emailVerified && adminEmails().has(email);
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email,
      emailVerified,
      firstName,
      role: isAdmin ? "admin" : "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return null;
    return {
      _id: user._id,
      firstName: user.firstName,
      email: user.email,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

// Not callable from clients. Run from the CLI:
//   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
export const setRole = internalMutation({
  args: { email: v.string(), role },
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
      .unique();
    if (user === null) fail("NOT_FOUND", "No user with that email has signed in yet.");
    await ctx.db.patch(user._id, { role });
    return user._id;
  },
});
