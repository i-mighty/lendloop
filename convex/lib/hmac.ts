// HMAC-SHA256 signing shared by both directions of the n8n integration.
//
// Convex -> n8n:  signature over `${timestamp}.${body}`
// n8n -> Convex:  signature over `${timestamp}.${METHOD}.${pathname}.${body}`
//
// The second form binds a request to one endpoint, so a captured signature cannot
// be replayed against a different route. The timestamp bounds replays in time.

export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function canonicalInbound(
  timestamp: string,
  method: string,
  pathname: string,
  body: string,
): string {
  return `${timestamp}.${method.toUpperCase()}.${pathname}.${body}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifySignature(params: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  message: (timestamp: string) => string;
  nowSeconds?: number;
}): Promise<VerifyResult> {
  const { secret, timestamp, signature } = params;
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  if (!/^\d{10}$/.test(timestamp)) return { ok: false, reason: "malformed timestamp" };

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = await hmacSha256Hex(secret, params.message(timestamp));
  return timingSafeEqual(provided, expected)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}
