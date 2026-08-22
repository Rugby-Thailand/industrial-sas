import { expect, test } from "@playwright/test";

test.describe("security headers", () => {
  test("private responses carry the enforced policy", async ({ request }) => {
    const response = await request.get("/th/dashboard");
    expect(response.status()).toBe(200);
    const headers = response.headers();

    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["content-security-policy"]).not.toContain("script-src");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["content-security-policy-report-only"]).toContain(
      "default-src 'self'",
    );
  });

  test("the protected sign-in page hydrates", async ({ page }) => {
    await page.goto("/th/dashboard");
    await expect(
      page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบ" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "กลับไปแดชบอร์ด" }),
    ).toBeVisible();
  });

  test("static assets keep the baseline policy", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
