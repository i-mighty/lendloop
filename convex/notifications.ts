import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { hmacSha256Hex, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/hmac";
import type { NotificationType } from "./lib/validators";

// Delays between delivery attempts: 30 s, 2 min, 10 min, 30 min. Five attempts in total.
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;

// Transactional outbox: the notification row is written in the same mutation as the
// loan change, and delivery is scheduled from that same transaction. If the mutation
// rolls back, no webhook is sent; if it commits, delivery is guaranteed to be attempted.
export async function enqueueNotification(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  recipientId: Id<"users">,
  type: NotificationType,
): Promise<void> {
  const notificationId = await ctx.db.insert("notifications", {
    loanId,
    recipientId,
    type,
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { notificationId });
}

// Builds the webhook body. Only what the workflow needs to write one message:
// no phone numbers, no notes, no ids of other users.
export const payload = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const notification = await ctx.db.get(notificationId);
    if (notification === null || notification.status !== "pending") return null;
    const loan = await ctx.db.get(notification.loanId);
    const recipient = await ctx.db.get(notification.recipientId);
    if (loan === null || recipient === null) return null;
    const tool = await ctx.db.get(loan.toolId);
    const counterpartId = recipient._id === loan.ownerId ? loan.borrowerId : loan.ownerId;
    const counterpart = await ctx.db.get(counterpartId);

    return {
      eventId: notification._id,
      type: notification.type,
      occurredAt: new Date(notification._creationTime).toISOString(),
      recipient: { email: recipient.email, firstName: recipient.firstName },
      counterpart: { firstName: counterpart?.firstName ?? "A neighbor" },
      tool: { name: tool?.name ?? "a tool" },
      loan: { status: loan.status, startDate: loan.startDate, endDate: loan.endDate },
      link: process.env.APP_URL
        ? `${process.env.APP_URL}/app/${recipient._id === loan.ownerId ? "incoming" : "requests"}`
        : null,
    };
  },
});

export const deliver = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const url = process.env.N8N_LOAN_EVENT_WEBHOOK_URL;
    const secret = process.env.CONVEX_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.recordOutcome, {
        notificationId,
        outcome: "skipped",
        error: "N8N_LOAN_EVENT_WEBHOOK_URL or CONVEX_TO_N8N_SECRET is not set",
      });
      return;
    }

    const body = await ctx.runQuery(internal.notifications.payload, { notificationId });
    if (body === null) return;

    const json = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacSha256Hex(secret, `${timestamp}.${json}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: `sha256=${signature}`,
        },
        body: json,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`n8n responded with HTTP ${response.status}`);
      await ctx.runMutation(internal.notifications.recordOutcome, {
        notificationId,
        outcome: "delivered",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.notifications.recordOutcome, {
        notificationId,
        outcome: "failed_attempt",
        error: message.slice(0, 300),
      });
    } finally {
      clearTimeout(timer);
    }
  },
});

export const recordOutcome = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    outcome: v.union(v.literal("delivered"), v.literal("failed_attempt"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { notificationId, outcome, error }) => {
    const notification = await ctx.db.get(notificationId);
    if (notification === null || notification.status !== "pending") return;
    const attempts = notification.attempts + 1;

    if (outcome === "delivered") {
      await ctx.db.patch(notificationId, { status: "delivered", attempts, deliveredAt: Date.now() });
    } else if (outcome === "skipped") {
      await ctx.db.patch(notificationId, { status: "skipped", lastError: error });
    } else if (attempts < MAX_ATTEMPTS) {
      await ctx.db.patch(notificationId, { attempts, lastError: error });
      await ctx.scheduler.runAfter(RETRY_DELAYS_MS[attempts - 1], internal.notifications.deliver, {
        notificationId,
      });
    } else {
      // Out of retries. The row stays visible as failed on the loan and in the admin view.
      await ctx.db.patch(notificationId, { status: "failed", attempts, lastError: error });
    }
  },
});
