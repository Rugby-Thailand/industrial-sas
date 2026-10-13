import { resolve } from "node:path";
import { expect, test, expectNoAxeViolations } from "../support/fixtures";

const url = `http://127.0.0.1:${process.env.BARCODE_PORT ?? 3199}`;

test("Job location rereads the same photo once through its centred overlay", async ({
  page,
}) => {
  await page.goto(`${url}/?presentation=jobScan&camera=portrait`);
  await page.evaluate(() => {
    window.locationAiResponse = { ok: true, candidates: [] };
  });
  await page.getByRole("button", { name: "Photo AI", exact: true }).click();
  await page
    .getByLabel("Choose photo", { exact: true })
    .and(page.locator('input[type="file"]'))
    .setInputFiles(resolve("tests/fixtures/barcode-photos/location-3-11.png"));
  const retry = page.getByRole("button", {
    name: "Read this photo again with AI",
    exact: true,
  });
  await expect(retry).toBeVisible();
  const photo = page.getByRole("img", { name: "Location label photo" });
  const imageBox = (await photo.boundingBox())!;
  const retryBox = (await retry.boundingBox())!;
  expect(
    Math.abs(retryBox.x + retryBox.width / 2 - imageBox.x - imageBox.width / 2),
  ).toBeLessThan(1);
  expect(
    Math.abs(
      retryBox.y + retryBox.height / 2 - imageBox.y - imageBox.height / 2,
    ),
  ).toBeLessThan(1);
  await expect(
    page.getByRole("button", { name: "Retry reading", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Take another photo", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.locationAiDelay = 600;
  });
  await photo.click({ position: { x: 10, y: 10 } });
  expect(await page.evaluate(() => window.locationAiRequests.length)).toBe(1);
  await retry.click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.locationAiCompleted))
    .toBe(2);
  await expect(retry).toBeVisible();
  const requests = await page.evaluate(() => window.locationAiRequests);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expectNoAxeViolations(page, "main");
});

test("Job location camera uses the available width and preserves the whole feed", async ({
  page,
}) => {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${url}/?presentation=jobScan&camera=portrait`);
    const video = page.locator("video");
    for (const [feedWidth, feedHeight] of [
      [480, 640],
      [1280, 720],
    ]) {
      if (feedWidth === 1280)
        await page.evaluate(() => window.resizeBarcodeFixtureCamera(1280, 720));
      await expect
        .poll(() =>
          video.evaluate((node) =>
            node instanceof HTMLVideoElement
              ? [node.videoWidth, node.videoHeight]
              : null,
          ),
        )
        .toEqual([feedWidth, feedHeight]);
      await expect
        .poll(async () => {
          const frame = (await video.boundingBox())!;
          return frame.width / frame.height;
        })
        .toBeCloseTo(feedWidth! / feedHeight!, 2);
      const frame = (await video.boundingBox())!;
      expect(frame.width).toBeCloseTo(width - 32, 0);
      expect(
        await video.evaluate((node) => getComputedStyle(node).objectFit),
      ).toBe("contain");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBe(0);
    }
    const choose = page.getByRole("button", {
      name: "Choose image",
      exact: true,
    });
    await expect(choose).toBeVisible();
    expect((await choose.boundingBox())!.width).toBeLessThanOrEqual(48);
  }
});
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
    const read = locale === "en" ? "Photo AI" : "ถ่ายรูป AI";
    await page.getByRole("button", { name: read, exact: true }).click();
    await page
      .getByLabel(locale === "en" ? "Choose photo" : "เลือกรูป", {
        exact: true,
      })
      .and(page.locator('input[type="file"]'))
      .setInputFiles(
        resolve("tests/fixtures/barcode-photos/location-3-11.png"),
      );
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
  await page.getByRole("button", { name: "Photo AI", exact: true }).click();
  const picker = page
    .getByLabel("Choose photo", { exact: true })
    .and(page.locator('input[type="file"]'));
  await picker.setInputFiles(
    resolve("tests/fixtures/barcode-photos/location-3-11.png"),
  );
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
  await picker.setInputFiles(
    resolve("tests/fixtures/barcode-photos/location-3-11.png"),
  );
  await expect
    .poll(() => page.evaluate(() => window.locationAiRequests.length))
    .toBe(2);
  await page.evaluate(() => {
    window.locationAiResponse = {
      ok: true,
      candidates: [{ code: "F1-L22-2", labelText: null }],
    };
  });
  await picker.setInputFiles(
    resolve("tests/fixtures/barcode-photos/location-22-2.webp"),
  );
  await expect(
    page.getByRole("textbox", { name: "Review location code" }),
  ).toHaveCount(0);
  // Wait for the recorded synthetic response to settle, then assert no stale review.
  await expect
    .poll(() => page.evaluate(() => window.locationAiCompleted))
    .toBe(3);
  await expect(
    page.getByRole("textbox", { name: "Review location code" }),
  ).toHaveValue("F1-L22-2");
  await page.getByRole("button", { name: "Close Photo AI" }).click();
  await expect(page.getByLabel("Decoded codes")).toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Choose image", exact: true }),
  ).toBeVisible();
});

test("AI opens a live camera, captures once, stops its stream and automatically extracts one image", async ({
  page,
}) => {
  await page.goto(`${url}/?camera=portrait`);
  await page.getByRole("button", { name: "Photo AI", exact: true }).click();
  const shutter = page.getByRole("button", {
    name: "Take location photo",
    exact: true,
  });
  await expect(shutter).toBeEnabled();
  const video = page.locator("video");
  for (const [width, height] of [
    [480, 640],
    [640, 480],
  ]) {
    await expect
      .poll(() =>
        video.evaluate((node) =>
          node instanceof HTMLVideoElement
            ? [node.videoWidth, node.videoHeight]
            : null,
        ),
      )
      .toEqual([width, height]);
    await expect
      .poll(async () => {
        const frame = await video.boundingBox();
        return frame!.width / frame!.height;
      })
      .toBeCloseTo(width! / height!, 2);
    if (width === 480)
      await page.evaluate(() => window.resizeBarcodeFixtureCamera(640, 480));
  }
  expect(await page.evaluate(() => window.locationAiRequests)).toEqual([]);
  await shutter.click();
  await expect(
    page.getByRole("img", { name: "Location label photo" }),
  ).toBeVisible();
  // Photo AI can cancel barcode startup before its lazy decoder acquires a
  // stream. Whether one or two cameras opened, every acquired track must stop.
  const trackStates = await page.evaluate(() =>
    window.barcodeFixtureStreams.flatMap((stream) =>
      stream.getTracks().map((track) => track.readyState),
    ),
  );
  expect(trackStates.length).toBeGreaterThan(0);
  expect(trackStates).toEqual(trackStates.map(() => "ended"));
  await expect(
    page.getByRole("button", { name: "Read location with AI", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Review location code" }),
  ).toHaveValue("F1-L3-11");
  await expect(page.getByLabel("Decoded codes")).toBeEmpty();
  await page
    .getByRole("button", { name: "Use this code", exact: true })
    .click();
  await expect(page.getByLabel("Decoded codes")).toHaveText("F1-L3-11");
});
