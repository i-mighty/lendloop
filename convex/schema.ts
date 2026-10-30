import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  automationKind,
  automationStatus,
  category,
  condition,
  loanStatus,
  notificationStatus,
  notificationType,
  role,
} from "./lib/validators";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    firstName: v.string(),
    role,
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    // Calendar dates as YYYY-MM-DD, inclusive, interpreted in UTC.
    startDate: v.string(),
    endDate: v.string(),
    status: loanStatus,
    note: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    closedReason: v.optional(v.string()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_status_end", ["status", "endDate"]),

  // Outbox for Convex -> n8n loan event webhooks. One row per event; its _id is the
  // eventId n8n uses to drop duplicate deliveries.
  notifications: defineTable({
    loanId: v.id("loans"),
    recipientId: v.id("users"),
    type: notificationType,
    status: notificationStatus,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
  }).index("by_loan", ["loanId"]),

  // Write-backs from n8n. idempotencyKey is unique, so a retried write-back updates
  // the existing row instead of creating a second one.
  automationEvents: defineTable({
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    kind: automationKind,
    status: automationStatus,
    detail: v.optional(v.string()),
    executionId: v.optional(v.string()),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  // Reported by the n8n error workflow so failed runs show up in the admin view.
  workflowErrors: defineTable({
    executionId: v.string(),
    workflowName: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
  }).index("by_execution", ["executionId"]),

  auditLog: defineTable({
    actorId: v.id("users"),
    action: v.string(),
    targetId: v.string(),
    detail: v.optional(v.string()),
  }),
});
