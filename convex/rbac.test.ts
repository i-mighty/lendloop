import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { DRILL, isoDate, newTest, signIn } from "./test.setup";

async function expectError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  // Outbound webhooks are covered in notifications.test.ts. Here, unconfigured
  // n8n just marks notifications as skipped.
  vi.stubEnv("N8N_LOAN_EVENT_WEBHOOK_URL", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("roles", () => {
  test("only a verified email on the server allowlist becomes admin", async () => {
    const t = newTest();
    const admin = await signIn(t, "Admin");
    expect((await admin.as.query(api.users.me, {}))?.role).toBe("admin");

    const ben = await signIn(t, "Ben");
    expect((await ben.as.query(api.users.me, {}))?.role).toBe("user");

    // Same allowlisted email, but unverified: stays a normal user.
    const t2 = newTest();
    const spoof = await signIn(t2, "Admin", { emailVerified: false });
    expect((await spoof.as.query(api.users.me, {}))?.role).toBe("user");
  });

  test("signed-out callers cannot write anything", async () => {
    const t = newTest();
    await expectError(t.mutation(api.tools.create, DRILL), "UNAUTHENTICATED");
    await expectError(t.mutation(api.users.ensure, {}), "UNAUTHENTICATED");
  });

  test("admin functions reject normal users", async () => {
    const t = newTest();
    const ben = await signIn(t, "Ben");
    await expectError(ben.as.query(api.admin.allLoans, {}), "FORBIDDEN");
    await expectError(ben.as.query(api.admin.automationHealth, {}), "FORBIDDEN");
    await expectError(
      ben.as.mutation(api.admin.setTrustedLender, { userId: ben.userId, trusted: true }),
      "FORBIDDEN",
    );
  });
});

describe("listings", () => {
  test("users cannot edit or delete someone else's listing", async () => {
    const t = newTest();
    const ada = await signIn(t, "Ada");
    const ben = await signIn(t, "Ben");
    const toolId = await ada.as.mutation(api.tools.create, DRILL);

    await expectError(
      ben.as.mutation(api.tools.update, { toolId, ...DRILL, name: "Mine now" }),
      "FORBIDDEN",
    );
    await expectError(ben.as.mutation(api.tools.remove, { toolId }), "FORBIDDEN");
  });

  test("admins can remove any listing; pending requests are declined and the action is audited", async () => {
    const t = newTest();
    const admin = await signIn(t, "Admin");
    const ada = await signIn(t, "Ada");
    const ben = await signIn(t, "Ben");
    const toolId = await ada.as.mutation(api.tools.create, DRILL);
    const loanId = await ben.as.mutation(api.loans.request, {
      toolId,
      startDate: isoDate(1),
      endDate: isoDate(2),
    });

    await admin.as.mutation(api.tools.remove, { toolId });

    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(loanId))?.status).toBe("declined");
      const audit = await ctx.db.query("auditLog").collect();
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe("tool.removed_by_admin");
    });
  });

  test("the public list exposes only name and category of available tools", async () => {
    const t = newTest();
    const ada = await signIn(t, "Ada");
    const ben = await signIn(t, "Ben");
    const drill = await ada.as.mutation(api.tools.create, DRILL);
    await ada.as.mutation(api.tools.create, { ...DRILL, name: "Tent", category: "camping" });

    const loanId = await ben.as.mutation(api.loans.request, {
      toolId: drill,
      startDate: isoDate(0),
      endDate: isoDate(1),
    });
    await ada.as.mutation(api.loans.approve, { loanId });

    expect(await t.query(api.tools.listPublic, {})).toEqual([{ name: "Tent", category: "camping" }]);
  });
});

describe("loans", () => {
  test("only the lender can approve, decline or mark returned", async () => {
    const t = newTest();
    const ada = await signIn(t, "Ada");
    const ben = await signIn(t, "Ben");
    const cy = await signIn(t, "Cy");
    const toolId = await ada.as.mutation(api.tools.create, DRILL);
    const loanId = await ben.as.mutation(api.loans.request, {
      toolId,
      startDate: isoDate(0),
      endDate: isoDate(1),
    });

    // The borrower and a stranger both get "not found", so loan ids cannot be probed.
    await expectError(ben.as.mutation(api.loans.approve, { loanId }), "NOT_FOUND");
    await expectError(cy.as.mutation(api.loans.decline, { loanId }), "NOT_FOUND");
    await expectError(cy.as.mutation(api.loans.cancel, { loanId }), "NOT_FOUND");

    await ada.as.mutation(api.loans.approve, { loanId });
    await expectError(ben.as.mutation(api.loans.markReturned, { loanId }), "NOT_FOUND");
    await ada.as.mutation(api.loans.markReturned, { loanId });

    expect((await ben.as.query(api.loans.myRequests, {}))[0].status).toBe("returned");
  });

  test("request rules: no self-borrowing, no past dates, no double booking", async () => {
    const t = newTest();
    const ada = await signIn(t, "Ada");
    const ben = await signIn(t, "Ben");
    const cy = await signIn(t, "Cy");
    const toolId = await ada.as.mutation(api.tools.create, DRILL);

    await expectError(
      ada.as.mutation(api.loans.request, { toolId, startDate: isoDate(1), endDate: isoDate(1) }),
      "INVALID_INPUT",
    );
    await expectError(
      ben.as.mutation(api.loans.request, { toolId, startDate: isoDate(-1), endDate: isoDate(1) }),
      "INVALID_INPUT",
    );
    await expectError(
      ben.as.mutation(api.loans.request, { toolId, startDate: "2026-02-30", endDate: "2026-03-01" }),
      "INVALID_INPUT",
    );

    const loanId = await ben.as.mutation(api.loans.request, {
      toolId,
      startDate: isoDate(1),
      endDate: isoDate(3),
    });
    await ada.as.mutation(api.loans.approve, { loanId });

    await expectError(
      cy.as.mutation(api.loans.request, { toolId, startDate: isoDate(3), endDate: isoDate(4) }),
      "CONFLICT",
    );
    // Back-to-back is fine.
    await cy.as.mutation(api.loans.request, { toolId, startDate: isoDate(4), endDate: isoDate(5) });
  });

  test("approving one request declines the overlapping ones", async () => {
    const t = newTest();
    const ada = await signIn(t, "Ada");
    const ben = await signIn(t, "Ben");
    const cy = await signIn(t, "Cy");
    const toolId = await ada.as.mutation(api.tools.create, DRILL);
    const first = await ben.as.mutation(api.loans.request, {
      toolId,
      startDate: isoDate(1),
      endDate: isoDate(3),
    });
    const second = await cy.as.mutation(api.loans.request, {
      toolId,
      startDate: isoDate(2),
      endDate: isoDate(4),
    });

    await ada.as.mutation(api.loans.approve, { loanId: first });

    await t.run(async (ctx) => {
      expect((await ctx.db.get(second))?.status).toBe("declined");
    });
    await expectError(ada.as.mutation(api.loans.approve, { loanId: second }), "CONFLICT");
  });

  test("setRole (CLI only, not in the public api) promotes a known user", async () => {
    const t = newTest();
    const ben = await signIn(t, "Ben");
    await t.mutation(internal.users.setRole, { email: "ben@example.com", role: "admin" });
    expect((await ben.as.query(api.users.me, {}))?.role).toBe("admin");
    await expectError(
      t.mutation(internal.users.setRole, { email: "nobody@example.com", role: "admin" }),
      "NOT_FOUND",
    );
  });
});
