import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../support/release-fixtures";

import {
  isOwnedIdentityHost,
  releaseSmokeInputs,
  clientScriptUrls,
} from "../support/release-env";

/**
 * @prod-safe release checks for a production candidate (`SMOKE_PHASE=candidate`,
 * the staged deployment URL) and the live domain (`SMOKE_PHASE=live`). They
 * also run against staging after its deployment.
 *
 * Read-only by construction: GET requests and one deliberately unsigned
 * webhook POST that the handler rejects before verification succeeds. No
 * seed, mutation or business record is touched.
 */

const pk = (host: string, keyClass: string) =>
  `pk_${keyClass}_${Buffer.from(`${host}$`).toString("base64")}`;

async function clientBundle(request: APIRequestContext, path: string) {
  const { baseUrl } = inputs();
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  const html = await response.text();
  const scripts = clientScriptUrls(html, baseUrl);
  const bodies = await Promise.all(
    scripts.map(async (src) => {
      const asset = await request.get(src);
      expect(asset.status()).toBe(200);
      return asset.text();
    }),
  );
  return `${html}\n${bodies.join("\n")}`;
}

function inputs() {
  return releaseSmokeInputs();
}

test.describe("@prod-safe release smoke", () => {
  test("serves the exact released commit", async ({ request }) => {
    const { expectedSha } = inputs();
    const response = await request.get("/th/sign-in");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-release-sha"]).toBe(expectedSha);
  });

  test("keeps the security headers", async ({ request }) => {
    inputs();
    const headers = (await request.get("/th/sign-in")).headers();
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["permissions-policy"]).toContain("camera=(self)");
  });

  test("routes signed-out requests to sign-in and keeps public pages public", async ({
    request,
  }) => {
    const { baseUrl } = inputs();
    const root = await request.get("/", { maxRedirects: 0 });
    expect([307, 308]).toContain(root.status());
    const privateRoute = await request.get("/th/master-data/storage-layouts", {
      maxRedirects: 0,
    });
    expect(privateRoute.status()).toBe(307);
    const location = new URL(privateRoute.headers().location!, baseUrl);
    expect(location.pathname).toBe("/th/sign-in");
    expect((await request.get("/en/about")).status()).toBe(200);
    expect((await request.get("/th/no-such-page")).status()).toBe(404);
  });

  test("ships identity and backend configuration for this target only", async ({
    request,
  }) => {
    const { target } = inputs();
    const bundle = await clientBundle(request, "/th/sign-in");
    expect(bundle).toContain(
      pk(target.clerkFrontendHost, target.clerkKeyClass),
    );
    const otherClass = target.clerkKeyClass === "live" ? "test" : "live";
    expect(bundle).not.toMatch(
      new RegExp(`pk_${otherClass}_[A-Za-z0-9+/=]{8,}`),
    );
    expect(bundle).toContain(`https://${target.convexDeployment}.convex.cloud`);
    expect(bundle).not.toMatch(/(127\.0\.0\.1|localhost):3210/);
    // The unconfigured fallback copy must not be what users see.
    const html = await (await request.get("/en/sign-in")).text();
    expect(html).not.toContain("Sign-in unavailable");
  });

  test("the Convex webhook route is deployed and has its signing secret", async ({
    playwright,
  }) => {
    // 400 = route present and secret configured, signature rejected.
    // 503 = signing secret missing; 404 = route missing. Neither applies data.
    const { target } = inputs();
    const convexSite = await playwright.request.newContext();
    try {
      const response = await convexSite.post(
        `https://${target.convexDeployment}.convex.site/webhooks/clerk`,
        { data: "{}", headers: { "content-type": "application/json" } },
      );
      expect(response.status()).toBe(400);
    } finally {
      await convexSite.dispose();
    }
  });

  test("the sign-in widget loads on a host the identity provider accepts", async ({
    page,
  }) => {
    const { baseUrl, target } = inputs();
    const owned = isOwnedIdentityHost(baseUrl, target.appUrl);
    expect(owned, "reviewed owned identity origin").toBe(true);

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/th/sign-in");
    await expect(
      page.locator(".cl-rootBox, .cl-signIn-root").first(),
    ).toBeVisible();
    await expect(page.getByText("ยังเข้าสู่ระบบไม่ได้")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("an optional synthetic identity can read its workspace", async ({
    page,
  }) => {
    const { baseUrl, name, target } = inputs();
    const identity = process.env.SMOKE_IDENTITY_EMAIL?.trim();
    const owned = isOwnedIdentityHost(baseUrl, target.appUrl);
    if (!identity || !owned) {
      test.info().annotations.push({
        type: "not-configured",
        description:
          "No synthetic production identity/owned host configured; authenticated reads are proved on staging.",
      });
    }
    test.skip(
      !identity || !owned,
      "Synthetic production identity not configured.",
    );

    const { clerk, setupClerkTestingToken } =
      await import("@clerk/testing/playwright");
    await setupClerkTestingToken({ page });
    await page.goto("/th/sign-in");
    await clerk.signIn({ page, emailAddress: identity! });
    await page.goto("/th/master-data/storage-layouts");
    await expect(page).toHaveURL(/\/th\/master-data\/storage-layouts/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    test.info().annotations.push({ type: "target", description: name });
  });
});
