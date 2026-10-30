import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  canonicalInbound,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "./lib/hmac";
import { isIsoDate, todayUtc } from "./lib/validators";

const MAX_BODY_BYTES = 16 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// Reads the raw body (the bytes that were signed) and verifies the n8n signature.
// Fails closed: no secret configured means every request is rejected.
async function authenticate(
  request: Request,
): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
  const secret = process.env.N8N_TO_CONVEX_SECRET;
  if (!secret) return { ok: false, response: json(503, { error: "integration not configured" }) };

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return { ok: false, response: json(413, { error: "body too large" }) };
  const body = request.method === "GET" ? "" : await request.text();
  if (body.length > MAX_BODY_BYTES) return { ok: false, response: json(413, { error: "body too large" }) };

  const pathname = new URL(request.url).pathname;
  const result = await verifySignature({
    secret,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    message: (ts) => canonicalInbound(ts, request.method, pathname, body),
  });
  if (!result.ok) {
    console.warn(`Rejected n8n request to ${pathname}: ${result.reason}`);
    return { ok: false, response: json(401, { error: "invalid signature" }) };
  }
  return { ok: true, body };
}

function parseObject(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const optionalString = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : undefined;

const http = httpRouter();

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;
    const today = todayUtc();
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today });
    return json(200, { date: today, loans });
  }),
});

http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    const input = parseObject(auth.body);
    if (
      input === null ||
      typeof input.loanId !== "string" ||
      typeof input.date !== "string" ||
      !isIsoDate(input.date) ||
      (input.status !== "sent" && input.status !== "failed")
    ) {
      return json(400, { error: "expected { loanId, date: YYYY-MM-DD, status: sent|failed }" });
    }

    const result = await ctx.runMutation(internal.automation.recordReminder, {
      loanId: input.loanId,
      date: input.date,
      status: input.status,
      detail: optionalString(input.detail, 300),
      executionId: optionalString(input.executionId, 100),
    });
    if (!result.ok) return json(404, { error: result.error });
    return json(200, { duplicate: result.duplicate });
  }),
});

http.route({
  path: "/n8n/workflow-error",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    const input = parseObject(auth.body);
    if (
      input === null ||
      typeof input.executionId !== "string" ||
      typeof input.workflowName !== "string" ||
      typeof input.message !== "string"
    ) {
      return json(400, { error: "expected { executionId, workflowName, message, node? }" });
    }
    const result = await ctx.runMutation(internal.automation.recordWorkflowError, {
      executionId: input.executionId,
      workflowName: input.workflowName,
      message: input.message,
      node: optionalString(input.node, 200),
    });
    return json(200, result);
  }),
});

export default http;
