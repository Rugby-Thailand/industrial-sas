/**
 * The response header policy, asserted as a contract rather than as a snapshot.
 *
 * Each assertion below names the attack the header exists to stop, so a future
 * edit that loosens one has to argue with a sentence rather than update a blob.
 * The end-to-end half — that a running server actually sends these — is
 * `tests/e2e/security-headers.e2e.spec.ts`, against `next start`; this tier
 * covers the policy's own shape, which is where the mistakes are.
 */
import { describe, expect, it } from "vitest";

import { SECURITY_POLICY, securityHeaders } from "./securityHeaders";

const asMap = (isProduction: boolean): Map<string, string> =>
  new Map(securityHeaders(isProduction).map((h) => [h.key, h.value]));

describe("securityHeaders", () => {
  it("stops the page being framed, by both the modern and the legacy header", () => {
    // Clickjacking a putaway confirmation moves real stock, so this is the one
    // that is asserted twice.
    const headers = asMap(true);
    expect(headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("refuses MIME sniffing", () => {
    expect(asMap(true).get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("never sends a document path to a cross-origin referrer", () => {
    // A path in this application can name a tenant's document.
    expect(asMap(true).get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("denies every browser feature the application does not use", () => {
    const policy = asMap(true).get("Permissions-Policy") ?? "";
    for (const feature of [
      "camera",
      "microphone",
      "geolocation",
      "payment",
      "usb",
      "display-capture",
    ]) {
      expect(policy, feature).toContain(`${feature}=()`);
    }
    // `=()` is the empty allowlist. `=*` or `=(self)` would be a permission.
    expect(policy).not.toMatch(/=\s*\*/);
  });

  it("sends HSTS only from a production build", () => {
    /*
     * Not a style preference. A developer terminating TLS in front of
     * `localhost` would otherwise pin their own machine's `localhost` to HTTPS
     * for the full max-age, and unpinning it means editing browser internals.
     */
    expect(asMap(true).get("Strict-Transport-Security")).toBe(
      SECURITY_POLICY.HSTS,
    );
    expect(asMap(false).has("Strict-Transport-Security")).toBe(false);
  });

  it("claims neither includeSubDomains nor preload", () => {
    /*
     * The two HSTS directives that cannot be walked back by deploying a fix.
     *
     * `includeSubDomains` pins every host in the zone — including ones this
     * application does not own — for the full max-age, and `preload` asks
     * browsers to ship the pin in their binaries, which takes months to undo.
     * Both are safe only after somebody has audited the zone and decided the
     * deployment wants that permanently. There is no domain yet, so asserting
     * either would be asserting something nobody has checked.
     *
     * When that audit happens, this test is the thing to update *first*, and the
     * ladder to follow is in the token's docstring.
     */
    const hsts = asMap(true).get("Strict-Transport-Security") ?? "";
    expect(hsts).not.toContain("includeSubDomains");
    expect(hsts).not.toContain("preload");
  });

  it("keeps the HSTS pin short enough to age out of a mistake", () => {
    // A ramp value, not a destination: long enough to defend a downgrade, short
    // enough that a misconfigured deployment clears from every client in a day.
    const maxAge = Number(
      /max-age=(\d+)/.exec(SECURITY_POLICY.HSTS)?.[1] ?? "0",
    );
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(86_400);
  });

  it("enforces only directives that cannot break a page", () => {
    /*
     * The enforced policy is allowed to contain exactly these four. Adding
     * `script-src` or `default-src` here without nonce plumbing in `proxy.ts`
     * blanks every screen, which is the failure this assertion exists to catch
     * in review rather than in production.
     */
    const enforced = SECURITY_POLICY.ENFORCED_CSP.split("; ").map(
      (d) => d.split(" ")[0],
    );
    expect(new Set(enforced)).toEqual(
      new Set(["frame-ancestors", "base-uri", "object-src", "form-action"]),
    );
  });

  it("keeps the unsafe directives in the reported policy only", () => {
    const headers = asMap(true);
    // `'unsafe-inline'` in an *enforced* script-src is a policy that permits the
    // injection it claims to stop. It belongs in the report-only draft.
    expect(headers.get("Content-Security-Policy")).not.toContain("unsafe-");
    expect(headers.get("Content-Security-Policy-Report-Only")).toContain(
      "'unsafe-inline'",
    );
  });

  it("reports against a policy that is strictly tighter than what it enforces", () => {
    // The draft has to be a superset, or the report-only run tells us nothing
    // about the directives already live.
    for (const directive of SECURITY_POLICY.ENFORCED_CSP.split("; ")) {
      expect(SECURITY_POLICY.REPORTED_CSP).toContain(directive);
    }
    expect(SECURITY_POLICY.REPORTED_CSP).toContain("default-src 'self'");
  });

  it("allows the Convex transport in the reported connect-src", () => {
    // A draft that would block the reactive socket teaches us nothing when the
    // deployment URL finally exists.
    expect(SECURITY_POLICY.REPORTED_CSP).toContain(
      "connect-src 'self' https: wss:",
    );
  });

  it("emits no duplicate header keys", () => {
    const keys = securityHeaders(true).map((h) => h.key);
    expect(keys).toHaveLength(new Set(keys).size);
  });
});
