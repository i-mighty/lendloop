import type { AuthConfig } from "convex/server";

// Clerk issues a short-lived JWT from the "convex" template (see
// scripts/clerk-jwt-template.json). Convex verifies its signature against the
// issuer's JWKS and checks that the audience is "convex".
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
