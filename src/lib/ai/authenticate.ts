import { verifyToken } from "@clerk/backend";
import { auth } from "@clerk/nextjs/server";

/** Reuse a browser token only when it belongs to the authenticated session's tenant. */
export async function authenticateAiRequest(request: Request) {
  const session = await auth();
  if (!session.userId || !session.orgId) return null;

  // Keep cookie-only callers working during deployment of the new browser client.
  const token = request.headers.get("x-convex-token");
  if (token === null) return session.getToken({ template: "convex" });
  if (token.length === 0 || token.length > 16_384) return null;
  const issuer = session.sessionClaims?.iss;
  if (typeof issuer !== "string" || issuer.length === 0) return null;

  const origin = new URL(request.url).origin;
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin !== null && requestOrigin !== origin) return null;

  try {
    // A template JWT has no session ID: Clerk middleware authenticates the
    // session bearer token/cookie, and this SDK verifies the forwarded JWT.
    // The SDK caches JWKS; CLERK_JWT_KEY also avoids the initial key fetch.
    const claims = await verifyToken(token, {
      audience: "convex",
      authorizedParties: [origin],
      jwtKey: process.env.CLERK_JWT_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    const audience = claims.aud;
    const forConvex =
      audience === "convex" ||
      (Array.isArray(audience) &&
        audience.every((entry) => typeof entry === "string") &&
        audience.includes("convex"));
    const organization: unknown = claims.o;
    // Match Convex's precedence: a malformed v2 organization cannot fall back
    // to a different, valid legacy org_id claim.
    const orgId =
      organization === undefined || organization === null
        ? claims.org_id
        : typeof organization === "object" &&
            !Array.isArray(organization) &&
            "id" in organization
          ? organization.id
          : null;
    if (
      !forConvex ||
      claims.iss !== issuer ||
      claims.sub !== session.userId ||
      orgId !== session.orgId
    )
      return null;
    return token;
  } catch {
    // Invalid/expired tokens never fall back to minting a replacement, and
    // verification errors never expose token contents to the caller.
    return null;
  }
}
