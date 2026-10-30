/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

export const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

export function newTest() {
  return convexTest(schema, modules);
}

export type TestConvex = ReturnType<typeof newTest>;

// Signs in as a Clerk user (verified email unless told otherwise) and creates the user row.
export async function signIn(
  t: TestConvex,
  name: string,
  options: { emailVerified?: boolean } = {},
) {
  const email = `${name.toLowerCase()}@example.com`;
  const as = t.withIdentity({
    subject: `user_${name}`,
    issuer: "https://clerk.test",
    tokenIdentifier: `https://clerk.test|user_${name}`,
    email,
    emailVerified: options.emailVerified ?? true,
    givenName: name,
  });
  const userId = await as.mutation(api.users.ensure, {});
  return { as, userId, email };
}

export function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export const DRILL = {
  name: "Cordless drill",
  category: "power_tools",
  condition: "good",
  description: "18V with two batteries.",
} as const;
