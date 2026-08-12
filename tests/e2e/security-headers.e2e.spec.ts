import { expect, test } from "@playwright/test";

/**
 * That the deployed response actually carries the security policy.
 *
 * `src/lib/securityHeaders.test.ts` asserts the policy's shape; this asserts it
 * survives the trip through `next.config.ts`, the build, and `next start`. The
 * two are not the same claim — a correct policy attached to the wrong `source`
 * pattern, or dropped by a config edit, is exactly the kind of change that
 * passes a unit test and ships nothing.
 *
 * These run against the **unconfigured** production server, which is the same
 * `next build` output a deployment serves. `next dev` is deliberately not used:
 * headers are a production concern and the dev server is not what ships.
 */
test.describe("security headers", () => {
  test("a page response carries the enforced policy", async ({ request }) => {
    const response = await request.get("/th/dashboard");
    expect(response.status()).toBe(200);
    const headers = response.headers();

    // Clickjacking, twice: `frame-ancestors` for CSP-aware browsers and
    // `X-Frame-Options` for the rest.
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-frame-options"]).toBe("DENY");

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");

    // The draft policy rides along without blocking anything.
    expect(headers["content-security-policy-report-only"]).toContain(
      "default-src 'self'",
    );

    /*
     * The enforced policy must not have grown a `script-src`. Next inlines its
     * bootstrap, so an enforced `script-src` without nonce plumbing in
     * `src/proxy.ts` renders a blank screen — and a blank screen is exactly what
     * an end-to-end suite should catch before an operator does.
     */
    expect(headers["content-security-policy"]).not.toContain("script-src");
  });

  test("the page it protects still renders", async ({ page }) => {
    /*
     * The assertion that makes the one above meaningful. A CSP that blocks the
     * application's own scripts satisfies every header check and serves a white
     * page, so the policy is only correct if the screen it guards still works.
     */
    const response = await page.goto("/th/dashboard");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Hydration reached the client tree: a CSP that killed the bootstrap would
    // leave the server HTML standing but no interactive shell behind it.
    await expect(page.getByTestId("locale-select")).toBeVisible();
  });

  test("a static asset is covered by the same policy", async ({ request }) => {
    // The `/:path*` source has to reach the manifest and the icons too — those
    // are served outside the locale routing the proxy matcher excludes.
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
