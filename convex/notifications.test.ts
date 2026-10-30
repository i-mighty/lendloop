import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { hmacSha256Hex } from "./lib/hmac";
import { DRILL, isoDate, newTest, signIn } from "./test.setup";

const SECRET = "test-convex-to-n8n-secret";
const WEBHOOK = "https://n8n.test/webhook/lendloop-loan-event";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_TO_N8N_SECRET", SECRET);
  vi.stubEnv("N8N_LOAN_EVENT_WEBHOOK_URL", WEBHOOK);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function requestDrill() {
  const t = newTest();
  const ada = await signIn(t, "Ada");
  const ben = await signIn(t, "Ben");
  const toolId = await ada.as.mutation(api.tools.create, DRILL);
  await ben.as.mutation(api.loans.request, {
    toolId,
    startDate: isoDate(1),
    endDate: isoDate(2),
    note: "Private note for the lender only",
  });
  return t;
}

describe("loan event webhooks", () => {
  test("are signed, and carry only the fields the message needs", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = await requestDrill();

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK);

    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    const expected = await hmacSha256Hex(SECRET, `${headers["x-lendloop-timestamp"]}.${body}`);
    expect(headers["x-lendloop-signature"]).toBe(`sha256=${expected}`);

    const payload = JSON.parse(body);
    expect(Object.keys(payload).sort()).toEqual(
      ["counterpart", "eventId", "link", "loan", "occurredAt", "recipient", "tool", "type"].sort(),
    );
    expect(payload.type).toBe("loan.requested");
    expect(payload.recipient).toEqual({ email: "ada@example.com", firstName: "Ada" });
    expect(payload.counterpart).toEqual({ firstName: "Ben" });
    expect(body).not.toContain("Private note");
    expect(body).not.toContain("ben@example.com");

    await t.run(async (ctx) => {
      const [notification] = await ctx.db.query("notifications").collect();
      expect(notification.status).toBe("delivered");
    });
  });

  test("are retried with backoff, then marked failed and shown on the loan", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = await requestDrill();

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    await t.run(async (ctx) => {
      const [notification] = await ctx.db.query("notifications").collect();
      expect(notification.status).toBe("failed");
      expect(notification.attempts).toBe(5);
      expect(notification.lastError).toContain("HTTP 500");
    });
  });

  test("a later success after failures is recorded once", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: ++calls < 3 ? 503 : 200 })),
    );
    const t = await requestDrill();

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toBe(3);
    await t.run(async (ctx) => {
      const notifications = await ctx.db.query("notifications").collect();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].status).toBe("delivered");
      expect(notifications[0].attempts).toBe(3);
    });
  });
});
