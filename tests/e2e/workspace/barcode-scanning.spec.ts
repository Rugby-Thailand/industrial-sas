import { resolve } from "node:path";
import { expect, test, expectNoAxeViolations } from "../support/fixtures";

const url = `http://127.0.0.1:${process.env.BARCODE_PORT ?? 3199}`;
const fixtures = [
  { name: "location-1.webp", code: "F2-L28-1" },
  { name: "location-18.webp", code: "F2-L28-18" },
  { name: "location-18.png", code: "F2-L28-18" },
  { name: "location-4-2.png", code: "F1-L4-2" },
  { name: "location-3-11.png", code: "F1-L3-11" },
  { name: "location-22-2.webp", code: "F1-L22-2" },
];

for (const locale of ["en", "th"] as const) {
  test(`reads the original Code 128 photos without camera permission (${locale})`, async ({
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
    const picker = page.getByRole("button", {
      name: locale === "en" ? "Choose image" : "เลือกรูปภาพ",
      exact: true,
    });
    await expect(picker).toBeEnabled();
    for (const fixture of fixtures) {
      await page
        .locator("input[type=file]")
        .setInputFiles(resolve("tests/fixtures/barcode-photos", fixture.name));
      await expect(page.getByLabel("Decoded codes")).toHaveText(
        fixtures
          .slice(0, fixtures.indexOf(fixture) + 1)
          .map((item) => item.code)
          .join(", "),
      );
      // The fixture's decoded <output> also has an implicit status role.
      await expect(page.locator('[role="status"]')).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
    await expect(page.getByLabel("Decoded codes")).toHaveText(
      fixtures.map((fixture) => fixture.code).join(", "),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBe(0);
    await expectNoAxeViolations(page, "main");
  });
}

test("the production photo decoder returns exactly the expected payloads", async ({
  page,
}) => {
  await page.goto(url);
  await expect
    .poll(() => page.evaluate(() => typeof window.runBarcodePhotoRegression))
    .toBe("function");
  const results = await page.evaluate(() => window.runBarcodePhotoRegression());
  expect(results).toEqual(
    fixtures.map((fixture) => ({
      path: `/${fixture.name}`,
      expected: fixture.code,
      codes: [fixture.code],
      pass: true,
    })),
  );
});

test("QR images still decode through the shared file picker", async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "Choose image" }),
  ).toBeEnabled();
  await page.evaluate(() => window.selectGeneratedBarcodePhoto("qr"));
  await expect(page.getByLabel("Decoded codes")).toHaveText("F1-L3");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("two distinct barcodes require a choice before applying a value", async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "Choose image" }),
  ).toBeEnabled();
  await page.evaluate(() => window.selectGeneratedBarcodePhoto("multiple"));
  await expect(
    page.getByRole("button", { name: "F2-L28-1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "F2-L28-18", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Decoded codes")).toBeEmpty();
  await page.getByRole("button", { name: "F2-L28-18", exact: true }).click();
  await expect(page.getByLabel("Decoded codes")).toHaveText("F2-L28-18");
  await expectNoAxeViolations(page, "main");
});

test("the real camera decoder reads a skewed label and stops its owned track", async ({
  page,
}) => {
  await page.goto(`${url}/?camera=location-18.webp`);
  await expect(page.getByLabel("Decoded codes")).toHaveText("F2-L28-18");
  expect(
    await page.evaluate(() =>
      window.barcodeFixtureStreams.flatMap((stream) =>
        stream.getTracks().map((track) => track.readyState),
      ),
    ),
  ).toEqual(["ended"]);
});
