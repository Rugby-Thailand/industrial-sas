import type { AuthConfig } from "convex/server";

/**
 * Clerk's first-class Convex integration puts `aud=convex` on the normal
 * session token. Convex verifies that token against this environment-specific
 * Frontend API / issuer domain; no custom JWT template is required.
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
