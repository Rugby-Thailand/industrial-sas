import { resolve } from "node:path";
import { expect, test, expectNoAxeViolations } from "../support/fixtures";

const url = `http://127.0.0.1:${process.env.BARCODE_PORT ?? 3199}`;
for (const locale of ["en", "th"] as const) {
  test(`AI location photo remains usable after camera denial and requires review (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      });
    });
    await page.goto(`${url}/?locale=${locale}`);
    await page
      .getByRole("button", {
        name: locale === "en" ? "Start camera" : "เปิดกล้อง",
        exact: true,
      })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(1);
    const read =
      locale === "en" ? "Read location with AI" : "อ่านตำแหน่งจากรูปด้วย AI";
    await page.getByRole("button", { name: read, exact: true }).click();
    await page
      .getByLabel(
        locale === "en" ? "Choose location image" : "เลือกรูปตำแหน่ง",
        { exact: true },
      )
      .setInputFiles(
        resolve("tests/fixtures/barcode-photos/location-3-11.png"),
      );
    await page.getByRole("button", { name: read, exact: true }).click();
    const code = page.getByRole("textbox", {
      name: locale === "en" ? "Review location code" : "ตรวจสอบรหัสตำแหน่ง",
    });
    await expect(code).toHaveValue("F1-L3-11");
    await expect(page.getByLabel("Decoded codes")).toBeEmpty();
    await expectNoAxeViolations(page, "main");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBe(0);
    const requests = await page.evaluate(() => window.locationAiRequests);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.prefix).toBe("data:image/jpeg;base64,");
    expect(requests[0]!.length).toBeLessThanOrEqual(4_000_000);
    expect(
      Math.max(requests[0]!.width, requests[0]!.height),
    ).toBeLessThanOrEqual(2000);
    await code.fill("F1-L3-12");
    await page
      .getByRole("button", {
        name: locale === "en" ? "Use this code" : "ใช้รหัสนี้",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Decoded codes")).toHaveText("F1-L3-12");
  });
}

test("AI multiple candidates require a choice and a fresh photo discards a late response", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => {
    window.locationAiResponse = {
      ok: true,
      candidates: [
        { code: "F1-L3-11", labelText: null },
        { code: "F1-L4-2", labelText: null },
      ],
    };
  });
  await page.getByRole("button", { name: "Read location with AI" }).click();
  const picker = page.getByLabel("Choose location image", { exact: true });
  await picker.setInputFiles(
    resolve("tests/fixtures/barcode-photos/location-3-11.png"),
  );
  await page.getByRole("button", { name: "Read location with AI" }).click();
  await expect(
    page.getByRole("button", { name: "F1-L4-2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use this code" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "F1-L4-2", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Review location code" }),
  ).toHaveValue("F1-L4-2");
  await page.evaluate(() => {
    window.locationAiDelay = 1200;
  });
  await page.getByRole("button", { name: "Read location with AI" }).click();
  await expect
    .poll(() => page.evaluate(() => window.locationAiRequests.length))
    .toBe(2);
  await picker.setInputFiles(
    resolve("tests/fixtures/barcode-photos/location-22-2.webp"),
  );
  await expect(
    page.getByRole("textbox", { name: "Review location code" }),
  ).toHaveCount(0);
  // Wait for the recorded synthetic response to settle, then assert no stale review.
  await expect
    .poll(() => page.evaluate(() => window.locationAiCompleted))
    .toBe(2);
  await expect(
    page.getByRole("textbox", { name: "Review location code" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to location scanner" }).click();
  await expect(page.getByLabel("Decoded codes")).toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Choose image", exact: true }),
  ).toBeVisible();
});
