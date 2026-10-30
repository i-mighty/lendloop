import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { canonicalInbound, hmacSha256Hex } from "./lib/hmac";
import { isoDate, newTest, signIn, type TestConvex } from "./test.setup";

const SECRET = "test-n8n-to-convex-secret";

async function signedRequest(
  t: TestConvex,
  method: "GET" | "POST",
  path: string,
  body = "",
  options: { signPath?: string; timestamp?: number; secret?: string } = {},
) {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = await hmacSha256Hex(
    options.secret ?? SECRET,
    canonicalInbound(timestamp, method, options.signPath ?? path, body),
  );
  return t.fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-lendloop-timestamp": timestamp,
      "x-lendloop-signature": `sha256=${signature}`,
    },
    body: method === "GET" ? undefined : body,
  });
}

async function seedOverdueLoan(t: TestConvex) {
  await signIn(t, "Ada");
  await signIn(t, "Ben");
  return await t.mutation(internal.seed.overdueLoan, {
    lenderEmail: "ada@example.com",
    borrowerEmail: "ben@example.com",
    daysOverdue: 2,
  });
}

beforeEach(() => {
  vi.stubEnv("N8N_TO_CONVEX_SECRET", SECRET);
  vi.stubEnv("N8N_LOAN_EVENT_WEBHOOK_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("signature checks on the n8n endpoints", () => {
  test("rejects missing, forged, stale and wrong-route signatures", async () => {
    const t = newTest();
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET" })).status).toBe(401);

    const forged = await signedRequest(t, "GET", "/n8n/overdue-loans", "", { secret: "guess" });
    expect(forged.status).toBe(401);

    const stale = await signedRequest(t, "GET", "/n8n/overdue-loans", "", {
      timestamp: Math.floor(Date.now() / 1000) - 600,
    });
    expect(stale.status).toBe(401);

    // A valid signature for one route does not work on another.
    const body = JSON.stringify({ loanId: "x", date: isoDate(0), status: "sent" });
    const replayed = await signedRequest(t, "POST", "/n8n/reminder-status", body, {
      signPath: "/n8n/workflow-error",
    });
    expect(replayed.status).toBe(401);
  });

  test("fails closed when the secret is not configured", async () => {
    vi.stubEnv("N8N_TO_CONVEX_SECRET", "");
    const t = newTest();
    const response = await signedRequest(t, "GET", "/n8n/overdue-loans");
    expect(response.status).toBe(503);
  });
});

describe("overdue reminders", () => {
  test("lists overdue loans with only the fields a reminder needs", async () => {
    const t = newTest();
    const loanId = await seedOverdueLoan(t);

    const response = await signedRequest(t, "GET", "/n8n/overdue-loans");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.loans).toEqual([
      {
        loanId,
        toolName: "Pressure washer",
        endDate: isoDate(-2),
        daysOverdue: 2,
        borrower: { email: "ben@example.com", firstName: "Ben" },
      },
    ]);
  });

  test("write-backs are idempotent and a sent reminder is not offered again", async () => {
    const t = newTest();
    const loanId = await seedOverdueLoan(t);
    const date = isoDate(0);

    const failed = JSON.stringify({ loanId, date, status: "failed", detail: "SMTP down" });
    expect((await signedRequest(t, "POST", "/n8n/reminder-status", failed)).status).toBe(200);
    expect((await signedRequest(t, "POST", "/n8n/reminder-status", failed)).status).toBe(200);

    // A failed reminder is still offered, so the next run can try again.
    let overdue = await (await signedRequest(t, "GET", "/n8n/overdue-loans")).json();
    expect(overdue.loans).toHaveLength(1);

    const sent = JSON.stringify({ loanId, date, status: "sent" });
    const first = await (await signedRequest(t, "POST", "/n8n/reminder-status", sent)).json();
    const retry = await (await signedRequest(t, "POST", "/n8n/reminder-status", sent)).json();
    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);

    await t.run(async (ctx) => {
      const events = await ctx.db.query("automationEvents").collect();
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("sent");
    });

    overdue = await (await signedRequest(t, "GET", "/n8n/overdue-loans")).json();
    expect(overdue.loans).toHaveLength(0);
  });

  test("rejects malformed write-backs", async () => {
    const t = newTest();
    const bad = JSON.stringify({ loanId: "nope", date: "yesterday", status: "sent" });
    expect((await signedRequest(t, "POST", "/n8n/reminder-status", bad)).status).toBe(400);
    const unknown = JSON.stringify({ loanId: "nope", date: isoDate(0), status: "sent" });
    expect((await signedRequest(t, "POST", "/n8n/reminder-status", unknown)).status).toBe(404);
  });
});

describe("workflow error reports", () => {
  test("are stored once per n8n execution", async () => {
    const t = newTest();
    const body = JSON.stringify({
      executionId: "42",
      workflowName: "LendLoop - Loan event notifications",
      node: "Send email",
      message: "SMTP connection refused",
    });
    await signedRequest(t, "POST", "/n8n/workflow-error", body);
    await signedRequest(t, "POST", "/n8n/workflow-error", body);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("workflowErrors").collect()).toHaveLength(1);
    });
  });
});
