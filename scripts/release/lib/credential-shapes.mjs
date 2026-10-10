// Credential shape classification without exposing values. Dependency-free
// and free of `import.meta`, so browser-suite helpers can import it too.

/**
 * Clerk publishable keys are `pk_<class>_<base64(frontendHost + "$")>`.
 * Returns `{ keyClass, frontendHost }` or null when malformed.
 */
export function decodePublishableKey(value) {
  const match = /^pk_(live|test)_([A-Za-z0-9+/=_-]+)$/.exec(value ?? "");
  if (!match) return null;
  let decoded;
  try {
    decoded = Buffer.from(match[2], "base64").toString("utf8");
  } catch {
    return null;
  }
  if (!decoded.endsWith("$")) return null;
  const frontendHost = decoded.slice(0, -1);
  if (!/^[a-z0-9.-]+$/i.test(frontendHost)) return null;
  return { keyClass: match[1], frontendHost };
}

/**
 * Classify a Convex deploy key without exposing it:
 * `prod:<name>|…` / `dev:<name>|…` → deployment key; `preview:team:project|…`
 * → preview key; `project:…|…` → project key.
 */
export function classifyConvexDeployKey(value) {
  const key = (value ?? "").trim();
  const bar = key.indexOf("|");
  if (bar <= 0 || bar === key.length - 1) return { kind: "malformed" };
  const prefix = key.slice(0, bar).split(":");
  if (prefix[0] === "preview") return { kind: "preview" };
  if (prefix[0] === "project") return { kind: "project" };
  if ((prefix[0] === "prod" || prefix[0] === "dev") && prefix.length === 2) {
    return { kind: "deployment", keyClass: prefix[0], deployment: prefix[1] };
  }
  return { kind: "malformed" };
}
