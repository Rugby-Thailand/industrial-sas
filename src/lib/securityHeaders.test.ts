import { describe, expect, it } from "vitest";

import { SECURITY_POLICY, securityHeaders } from "./securityHeaders";

const asMap = (isProduction: boolean): Map<string, string> =>
  new Map(securityHeaders(isProduction).map((h) => [h.key, h.value]));

describe("securityHeaders", () => {
  it("stops the page being framed, by both the modern and the legacy header", () => {
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
    expect(asMap(true).get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("allows only the same-origin camera and denies unused browser features", () => {
    const policy = asMap(true).get("Permissions-Policy") ?? "";
    for (const feature of [
      "microphone",
      "geolocation",
      "payment",
      "usb",
      "display-capture",
    ]) {
      expect(policy, feature).toContain(`${feature}=()`);
    }

    expect(policy).toContain("camera=(self)");
    expect(policy).not.toMatch(/=\s*\*/);
  });

  it("sends HSTS only from a production build", () => {
    expect(asMap(true).get("Strict-Transport-Security")).toBe(
      SECURITY_POLICY.HSTS,
    );
    expect(asMap(false).has("Strict-Transport-Security")).toBe(false);
  });

  it("claims neither includeSubDomains nor preload", () => {
    const hsts = asMap(true).get("Strict-Transport-Security") ?? "";
    expect(hsts).not.toContain("includeSubDomains");
    expect(hsts).not.toContain("preload");
  });

  it("keeps the HSTS pin short enough to age out of a mistake", () => {
    const maxAge = Number(
      /max-age=(\d+)/.exec(SECURITY_POLICY.HSTS)?.[1] ?? "0",
    );
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(86_400);
  });

  it("enforces only directives that cannot break a page", () => {
    const enforced = SECURITY_POLICY.ENFORCED_CSP.split("; ").map(
      (d) => d.split(" ")[0],
    );
    expect(new Set(enforced)).toEqual(
      new Set(["frame-ancestors", "base-uri", "object-src", "form-action"]),
    );
  });

  it("keeps the unsafe directives in the reported policy only", () => {
    const headers = asMap(true);

    expect(headers.get("Content-Security-Policy")).not.toContain("unsafe-");
    expect(headers.get("Content-Security-Policy-Report-Only")).toContain(
      "'unsafe-inline'",
    );
  });

  it("reports against a policy that is strictly tighter than what it enforces", () => {
    for (const directive of SECURITY_POLICY.ENFORCED_CSP.split("; ")) {
      expect(SECURITY_POLICY.REPORTED_CSP).toContain(directive);
    }
    expect(SECURITY_POLICY.REPORTED_CSP).toContain("default-src 'self'");
  });

  it("allows the Convex transport in the reported connect-src", () => {
    expect(SECURITY_POLICY.REPORTED_CSP).toContain(
      "connect-src 'self' https: wss:",
    );
  });

  it("emits no duplicate header keys", () => {
    const keys = securityHeaders(true).map((h) => h.key);
    expect(keys).toHaveLength(new Set(keys).size);
  });
});
