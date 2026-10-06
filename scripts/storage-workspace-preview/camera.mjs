import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
async function center() {
  return page
    .locator('svg[aria-label="Interactive floor map"]')
    .evaluate((svg) => {
      const group = svg.querySelector(":scope > g");
      const floor = group.querySelector(":scope > polygon");
      const box = svg.getBoundingClientRect();
      const point = new DOMPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      ).matrixTransform(group.getScreenCTM().inverse());
      const bounds = floor.getBBox();
      return {
        x: (point.x - bounds.x) / bounds.width,
        y: (point.y - bounds.y) / bounds.height,
      };
    });
}
try {
  await page.goto("http://127.0.0.1:3190/?fixture=empty");
  await expect(page.locator("[data-map-zone-id]")).toHaveCount(198);
  const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
  while (await zoom.isEnabled()) await zoom.click();
  await page.waitForTimeout(300);
  const box = await page
    .locator('svg[aria-label="Interactive floor map"]')
    .boundingBox();
  await page.evaluate(() => (window.__storageWorkspaceProfile = []));
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let n = 1; n <= 50; n++)
    await page.mouse.move(x + (100 * n) / 50, y + (55 * n) / 50);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const commits = await page.evaluate(
    () =>
      window.__storageWorkspaceProfile.filter((p) => p.phase === "update")
        .length,
  );
  expect(commits).toBe(1);
  const original = await center();
  const samples = [];
  for (const view of ["Split view", "Map view", "Table view", "Map view"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.waitForTimeout(300);
    if (view === "Table view") continue;
    const current = await center();
    samples.push({ view, ...current });
    expect(Math.abs(current.x - original.x)).toBeLessThan(0.00001);
    expect(Math.abs(current.y - original.y)).toBeLessThan(0.00001);
  }
  fs.writeFileSync(
    "output/workspace-qa/camera-results.json",
    JSON.stringify({ commits, original, samples }, null, 2),
  );
  console.log(
    "Camera center retained across panels; 50-move drag committed once.",
  );
} finally {
  await context.close();
  await browser.close();
}
