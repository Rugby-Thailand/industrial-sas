import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, expectNoAxeViolations, test } from "../support/fixtures";

const url = "http://127.0.0.1:3219";

async function choose(page: Page, codes: string[], qr = false) {
  await page.evaluate(
    async ({ codes, qr }) => {
      const transfer = new DataTransfer();
      transfer.items.add(await window.barcodeFixture(codes, qr));
      const input =
        document.querySelector<HTMLInputElement>("input[type=file]")!;
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { codes, qr },
  );
}

async function accept(page: Page) {
  await expect(
    page.getByRole("button", { name: "Use scanned code(s)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use scanned code(s)" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
    });
  });
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Scan job tickets" }),
  ).toBeVisible();
});

test("real image worker decodes barcode pixels, QR, rotation and negatives", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const rows = await page.evaluate(() =>
    window.runSyntheticBarcodeRegression(),
  );
  expect(rows).toHaveLength(8);
  for (const row of rows) expect(row).toMatchObject({ pass: true });
  expect(
    requests.filter((request) => request.endsWith("zxing_reader.wasm")).length,
  ).toBeGreaterThan(0);
  expect(requests.every((request) => new URL(request).origin === url)).toBe(
    true,
  );
});

test("camera denial still allows local location QR and paired ticket intake through save", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page
    .getByRole("button", { name: "Scan location barcode or QR" })
    .click();
  await expect(page.getByText(/Camera access was denied/)).toBeVisible();
  await choose(page, ["F2-L28-18"], true);
  await expect(
    page.getByRole("button", { name: "Use scanned code(s)" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan barcode" })).toHaveCount(
    0,
  );
  await accept(page);
  await page.getByRole("button", { name: "Scan barcode", exact: true }).click();
  await choose(page, ["FO12345678", "DEMO-PRODUCT"]);
  await accept(page);
  await expect(page.getByRole("textbox", { name: /Job No\./ })).toHaveValue(
    "FO12345678",
  );
  await expect(
    page.getByRole("textbox", { name: /Product barcode/ }),
  ).toHaveValue("DEMO-PRODUCT");
  await expectNoAxeViolations(page);
  await page
    .getByRole("button", { name: "Save 1 ticket", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved 1 ticket" }),
  ).toBeVisible();
  const calls = await page.evaluate(() => window.barcodePreview.calls);
  expect(calls).toEqual([
    {
      kind: "finishedGoods/scanning:resolveLocationCode",
      args: { warehouseId: "demo-warehouse", code: "F2-L28-18" },
    },
    {
      kind: "save",
      args: expect.objectContaining({
        warehouseId: "demo-warehouse",
        locationText: "F2-L28-18",
        location: { zoneId: "demo-zone" },
        items: [
          {
            source: "BARCODE",
            factoryOrder: "FO12345678",
            productBarcodeText: "DEMO-PRODUCT",
          },
        ],
      }),
    },
  ]);
  expect(writes).toEqual([]);
});

test("pending image cancellation releases its worker and cannot resolve a location", async ({
  page,
}) => {
  await page.evaluate(() => {
    const owned = { active: 0 };
    Object.assign(window, { barcodeWorkerAudit: owned });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        owned.active++;
      }
      override terminate() {
        owned.active--;
        super.terminate();
      }
    };
  });
  await page
    .getByRole("button", { name: "Scan location barcode or QR" })
    .click();
  await choose(page, []);
  await expect(page.getByText("Reading barcodes…")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(() => Reflect.get(window, "barcodeWorkerAudit").active),
  ).toBe(0);
  expect(await page.evaluate(() => window.barcodePreview.calls)).toEqual([]);
  await choose(page, ["F2-L28-18"]);
  await accept(page);
  await expect(
    page.getByRole("button", { name: "Scan barcode", exact: true }),
  ).toBeVisible();
});

test("field image replacement requires confirmation and Escape preserves the prior value", async ({
  page,
}) => {
  await page.getByRole("button", { name: /F2-L28-18/ }).click();
  await page
    .getByRole("button", { name: "Type manually", exact: true })
    .click();
  const product = page.getByRole("textbox", {
    name: /Product barcode/,
    includeHidden: true,
  });
  await product.fill("OLD-PRODUCT");
  await page
    .getByRole("button", { name: "Scan Product barcode", exact: true })
    .click();
  await choose(page, ["DEMO-PRODUCT"]);
  await accept(page);
  await expect(
    page.getByRole("button", { name: "Replace value" }),
  ).toBeVisible();
  await expect(product).toHaveValue("OLD-PRODUCT");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(product).toHaveValue("OLD-PRODUCT");
  await page
    .getByRole("button", { name: "Scan Product barcode", exact: true })
    .click();
  await choose(page, ["DEMO-PRODUCT"]);
  await accept(page);
  await page.getByRole("button", { name: "Replace value" }).click();
  await expect(product).toHaveValue("DEMO-PRODUCT");
});

test("image controls fit narrow screens in both languages and themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page
    .getByRole("button", { name: "Scan location barcode or QR" })
    .click();
  await choose(page, ["F2-L28-18"]);
  await expect(
    page.getByRole("button", { name: "Use scanned code(s)" }),
  ).toBeVisible();
  for (const locale of ["en", "th"]) {
    if (locale === "th")
      await page.getByRole("button", { name: "ไทย", exact: true }).click();
    for (const theme of ["dark", "light"]) {
      await page.evaluate(async (theme) => {
        document.documentElement.className = theme;
        await Promise.all(
          document
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      }, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      ).toEqual([]);
    }
  }
});
