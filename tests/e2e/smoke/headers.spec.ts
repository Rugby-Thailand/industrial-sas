import { expect, test } from "../support/fixtures";

/** Response headers from the production server (next.config.ts headers()). */
test.describe("security headers", () => {
  test("document responses carry the enforced and reported policies", async ({
    request,
  }) => {
    const response = await request.get("/th/sign-in");
    expect(response.status()).toBe(200);
    const headers = response.headers();

    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["content-security-policy"]).not.toContain("script-src");
    expect(headers["content-security-policy-report-only"]).toContain(
      "default-src 'self'",
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    // The destination scanner needs same-origin camera access only.
    expect(headers["permissions-policy"]).toContain("camera=(self)");
    expect(headers["permissions-policy"]).toContain("microphone=()");
    expect(headers["strict-transport-security"]).toBe("max-age=86400");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("redirects carry the same policy", async ({ request }) => {
    const response = await request.get("/th/finished-goods", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(response.headers()["x-frame-options"]).toBe("DENY");
  });

  test("only the reference plans may be framed, and only by this origin", async ({
    request,
  }) => {
    const response = await request.get("/f1-f2-reference/f1-2d.html");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'self'",
    );
  });

  test("static assets keep the baseline policy", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("an unreleased build publishes no release SHA", async ({ request }) => {
    const response = await request.get("/th/sign-in");
    expect(response.headers()["x-release-sha"]).toBeUndefined();
  });
});
