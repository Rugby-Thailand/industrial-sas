import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, expectNoAxeViolations, test } from "../support/fixtures";

const url = "http://127.0.0.1:3219";

async function installCamera(page: Page) {
  await page.evaluate(() => {
    window.barcodeFixtureStreams = [];
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d")!;

    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const stream = canvas.captureStream(12);
        window.barcodeFixtureStreams.push(stream);
        // WebKit needs frames arriving after the video element attaches.
        let frame = 0;
        const timer = window.setInterval(() => {
          if (!stream.active) {
            window.clearInterval(timer);
            return;
          }
          context.fillStyle = frame++ % 2 ? "#121212" : "#101010";
          context.fillRect(0, 0, canvas.width, canvas.height);
        }, 100);
        return stream;
      },
    });
  });
}

function activeCameraTracks(page: Page) {
  return page.evaluate(
    () =>
      window.barcodeFixtureStreams
        .flatMap((stream) => stream.getTracks())
        .filter((track) => track.readyState === "live").length,
  );
}

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
      configurable: true,
      value: () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
    });
  });
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Where are we?" }),
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
  expect(rows).toHaveLength(11);
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
  await page.getByRole("button", { name: "Scan code", exact: true }).click();
  await expect(page.getByText(/Camera access was denied/)).toBeVisible();
  await choose(page, ["F2-L28-18"], true);
  await expect(
    page.getByRole("button", { name: "Use scanned code(s)" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scan pallet" })).toHaveCount(
    0,
  );
  await accept(page);
  await page.getByRole("button", { name: "Scan code", exact: true }).click();
  await choose(page, ["FO12345678", "DEMO-PRODUCT"]);
  await page.getByRole("button", { name: "View full label image" }).click();
  const review = page.getByRole("dialog", { name: "View full label image" });
  await expect(review).toBeVisible();
  await expect(
    review.getByRole("img", { name: "Selected barcode label" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View full label image" }),
  ).toHaveCount(0);
  await expectNoAxeViolations(page);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toHaveCount(0);
  await accept(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
      kind: "finishedGoods/jobScanLocations:resolve",
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
            storageFormat: "PALLET",
            factoryOrder: "FO12345678",
            productBarcodeText: "DEMO-PRODUCT",
          },
        ],
      }),
    },
  ]);
  expect(writes).toEqual([]);
});

test("repeated image pairs retain two physical units and require duplicate review", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Scan code", exact: true }).click();
  await choose(page, ["F2-L28-18"], true);
  await accept(page);
  await page.getByRole("button", { name: "Scan code", exact: true }).click();
  for (let unit = 0; unit < 2; unit++) {
    await choose(page, ["FO12345678", "DEMO-PRODUCT"]);
    await accept(page);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /Job No\./ })).toHaveCount(2);
  const save = page.getByRole("button", {
    name: "Save 2 tickets",
    exact: true,
  });
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByRole("heading", { name: "Saved 2 tickets" }),
  ).toBeVisible();
  const calls = await page.evaluate(() => window.barcodePreview.calls);
  expect(calls.filter((call) => call.kind === "save")).toEqual([
    {
      kind: "save",
      args: expect.objectContaining({
        items: [
          {
            source: "BARCODE",
            storageFormat: "PALLET",
            factoryOrder: "FO12345678",
            productBarcodeText: "DEMO-PRODUCT",
          },
          {
            source: "BARCODE",
            storageFormat: "PALLET",
            factoryOrder: "FO12345678",
            productBarcodeText: "DEMO-PRODUCT",
          },
        ],
      }),
    },
  ]);
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
  await page.getByRole("button", { name: "Scan code", exact: true }).click();
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
    page.getByRole("heading", { name: "Scan pallet" }),
  ).toBeVisible();
});

test("field image replacement requires confirmation and Escape preserves the prior value", async ({
  page,
}) => {
  // The location catalogue answers a search instead of listing everything.
  await page
    .getByRole("textbox", { name: "Search location" })
    .fill("F2-L28-18");
  await page.getByRole("button", { name: /F2-L28-18/ }).click();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
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
  for (const locale of ["en", "th"]) {
    if (locale === "th")
      await page.getByRole("button", { name: "ไทย", exact: true }).click();
    await page
      .getByRole("button", {
        name: locale === "en" ? "Scan code" : "สแกนรหัส",
        exact: true,
      })
      .click();
    await choose(page, ["F2-L28-18"]);
    await expect(
      page.getByRole("button", {
        name: locale === "en" ? "Use scanned code(s)" : "ใช้รหัสที่อ่านได้",
      }),
    ).toBeVisible();
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
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("the location camera fills the viewport through rotation and Back releases its live track", async ({
  page,
}) => {
  await installCamera(page);
  const opener = page.getByRole("button", { name: "Scan code", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog");
  const video = dialog.locator("video");
  await expect
    .poll(() =>
      video.evaluate((node) =>
        node instanceof HTMLVideoElement ? node.videoWidth : 0,
      ),
    )
    .toBe(640);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() => dialog.boundingBox())
      .toEqual({
        x: 0,
        y: 0,
        width: expect.closeTo(viewport.width, 1),
        height: expect.closeTo(viewport.height, 1),
      });
    const frame = await video.boundingBox();
    expect(frame!.width / frame!.height).toBeCloseTo(4 / 3, 1);
    expect(frame!.height).toBeGreaterThan(120);
    expect(
      await video.evaluate((node) => getComputedStyle(node).objectFit),
    ).toBe("contain");
    await expect(
      dialog.getByRole("button", { name: "Choose image", exact: true }),
    ).toBeInViewport({ ratio: 1 });
  }
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect.poll(() => activeCameraTracks(page)).toBe(0);
});

test("ticket photo capture stays usable in landscape and retains its photo after Close", async ({
  page,
}) => {
  await installCamera(page);
  await page
    .getByRole("textbox", { name: "Search location" })
    .fill("F2-L28-18");
  await page.getByRole("button", { name: /F2-L28-18/ }).click();
  const opener = page.getByRole("button", { name: "Photo AI", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog");
  const shutter = dialog.getByRole("button", {
    name: "Take photo",
    exact: true,
  });
  const feed = dialog.locator("video");
  await expect
    .poll(() =>
      feed.evaluate((video) =>
        video instanceof HTMLVideoElement ? video.videoWidth : 0,
      ),
    )
    .toBe(640);
  await shutter.click();
  const send = dialog.getByRole("button", { name: "Read 1 photo with AI" });
  await expect(send).toBeEnabled();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(shutter).toBeInViewport({ ratio: 1 });
  await expect(send).toBeInViewport({ ratio: 1 });
  const frame = await feed.boundingBox(),
    button = await shutter.boundingBox();
  expect(frame!.x + frame!.width).toBeLessThanOrEqual(button!.x);
  await dialog.getByRole("button", { name: "Close camera" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect.poll(() => activeCameraTracks(page)).toBe(0);
  await opener.click();
  await expect(send).toBeEnabled();
});

test("switching a live location camera to Photo AI keeps one stream and restores the typed location", async ({
  page,
}) => {
  await installCamera(page);
  const input = page.getByRole("textbox", { name: "Search location" });
  await input.fill("dock");
  await page.getByRole("button", { name: "Scan code", exact: true }).click();
  const qr = page.getByRole("dialog", { name: "Scan code", exact: true });
  await expect.poll(() => activeCameraTracks(page)).toBe(1);
  await qr.getByRole("button", { name: "Photo AI", exact: true }).click();
  const photo = page.getByRole("dialog", {
    name: "Read a location label",
    exact: true,
  });
  await expect(
    photo.getByRole("button", { name: "Take location photo", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => activeCameraTracks(page)).toBe(1);
  await page.goBack();
  await expect(
    qr.getByRole("button", { name: "Choose image", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    photo.getByRole("button", { name: "Take location photo", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => activeCameraTracks(page)).toBe(1);
  await page.keyboard.press("Escape");
  await qr.getByRole("button", { name: "Close camera", exact: true }).click();
  await expect(input).toHaveValue("dock");
  await expect.poll(() => activeCameraTracks(page)).toBe(0);
});

test("confirming a location photo retains the unsaved ticket when changing its location", async ({
  page,
}) => {
  await installCamera(page);
  await page
    .getByRole("textbox", { name: "Search location" })
    .fill("F2-L28-18");
  await page.getByRole("button", { name: /F2-L28-18/ }).click();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  const product = page.getByRole("textbox", { name: /Product barcode/ });
  await product.fill("DRAFT-PRODUCT");
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("button", { name: "Photo AI", exact: true }).click();
  const photo = page.getByRole("dialog", { name: "Read a location label" });
  await photo.getByRole("button", { name: "Take location photo" }).click();
  await expect(
    photo.getByRole("textbox", { name: "Review location code" }),
  ).toHaveValue("F2-L28-18");
  await photo.getByRole("button", { name: "Use this code" }).click();
  await expect(product).toHaveValue("DRAFT-PRODUCT");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => activeCameraTracks(page)).toBe(0);
});
