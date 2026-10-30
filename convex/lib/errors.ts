import { ConvexError } from "convex/values";
import { normalizeText } from "./validators";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT";

export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

export function requireText(value: string, field: string, max: number): string {
  const text = normalizeText(value);
  if (text.length === 0) fail("INVALID_INPUT", `${field} is required.`);
  if (text.length > max) fail("INVALID_INPUT", `${field} must be ${max} characters or fewer.`);
  return text;
}

export function optionalText(
  value: string | undefined,
  field: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  const text = normalizeText(value);
  if (text.length === 0) return undefined;
  if (text.length > max) fail("INVALID_INPUT", `${field} must be ${max} characters or fewer.`);
  return text;
}
