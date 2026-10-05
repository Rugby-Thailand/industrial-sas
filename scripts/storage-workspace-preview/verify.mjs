import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const output = path.resolve("output/workspace-qa");
async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  async function record(viewport, name, steps) {
    const context = await browser.newContext({
      viewport,
      recordVideo: { dir: output, size: viewport },
      colorScheme: "dark",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:3190/");
    await expect(
      page.getByRole("button", { name: "Map view", exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(1000);
    await steps(page);
    expect(errors).toEqual([]);
    const video = page.video();
    await context.close();
    await video.saveAs(path.join(output, `${name}.webm`));
    results.push({ name, viewport, errors });
  }
  const pause = (page) => page.waitForTimeout(1100);
  await record({ width: 1440, height: 900 }, "desktop", async (page) => {
    await expect(page.locator("[data-map-zone-id]")).toHaveCount(198);
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.screenshot({ path: path.join(output, "desktop-map.png") });
    await page.locator("summary").filter({ hasText: "Floor 2" }).click();
    await pause(page);
    await expect(
      page.getByRole("navigation", { name: "Building floors" }),
    ).toBeVisible();
    await page.screenshot({ path: path.join(output, "desktop-floors.png") });
    await page.locator("summary").filter({ hasText: "Floor 2" }).click();
    await page.getByRole("button", { name: "Table view", exact: true }).click();
    await pause(page);
    const scroll = page.getByRole("table").locator("..").locator("..");
    await scroll.evaluate((el) => (el.scrollTop = 500));
    await pause(page);
    const bodyBox = await scroll.boundingBox(),
      headBox = await page.locator("thead").boundingBox();
    expect(Math.abs(headBox.y - bodyBox.y)).toBeLessThan(3);
    await page.screenshot({ path: path.join(output, "desktop-table.png") });
    await scroll.evaluate((el) => (el.scrollTop = 0));
    await page.getByRole("button", { name: "Next page" }).click();
    await pause(page);
    await expect(page.getByText("Page 2 / 8")).toBeVisible();
    await page
      .getByRole("button", {
        name: "Select location PD-L3-11 · PD-L3-11",
        exact: true,
      })
      .click();
    await pause(page);
    await page.getByRole("button", { name: "Map view", exact: true }).click();
    await pause(page);
    await expect(page.locator('[data-map-zone-id="PD-L3-11"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Hide details" }).click();
    await pause(page);
    await expect(page.locator('[data-map-zone-id="PD-L3-11"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page
      .getByRole("button", { name: "PD-L3-11 · Location details", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
    await page.getByRole("button", { name: "Fit floor to view" }).click();
    await page.getByRole("button", { name: "Split view", exact: true }).click();
    await pause(page);
    await page.getByRole("button", { name: "Filter locations" }).click();
    await page.getByRole("button", { name: "Stored", exact: true }).click();
    await page.keyboard.press("Escape");
    await pause(page);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("searchbox").fill("DEMO-P-7");
    await pause(page);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.screenshot({
      path: path.join(output, "desktop-split-filter.png"),
    });
    await page.getByRole("searchbox").fill("no-matches");
    await pause(page);
    await expect(page.getByText("No storage locations match")).toBeVisible();
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await page.getByRole("button", { name: "Filter locations" }).click();
    await page.getByRole("button", { name: "Stored", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Light / dark" }).click();
    await pause(page);
    await page.screenshot({ path: path.join(output, "desktop-light.png") });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBe(0);
    await page.getByRole("button", { name: "Map view", exact: true }).click();
    await page.getByRole("button", { name: "3D view", exact: true }).click();
    await pause(page);
    await page.screenshot({ path: path.join(output, "desktop-3d.png") });
    await page.getByRole("button", { name: "2D plan", exact: true }).click();
  });
  await record({ width: 390, height: 844 }, "mobile", async (page) => {
    await expect(
      page.getByRole("button", { name: "Split view", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBe(0);
    await page.screenshot({ path: path.join(output, "mobile-map.png") });
    await page.getByRole("button", { name: "Table view", exact: true }).click();
    await pause(page);
    await page.getByRole("searchbox").fill("PD-L1-8");
    await pause(page);
    await page
      .getByRole("button", {
        name: "Select location PD-L1-8 · PD-L1-8",
        exact: true,
      })
      .click();
    await pause(page);
    await expect(
      page.getByRole("dialog", { name: "Location details" }),
    ).toBeVisible();
    await page.screenshot({ path: path.join(output, "mobile-details.png") });
    await page.keyboard.press("Escape");
    await pause(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Map view", exact: true }).click();
    await pause(page);
    await expect(page.locator('[data-map-zone-id="PD-L1-8"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await page.locator("summary").filter({ hasText: "Floor 2" }).click();
    await pause(page);
    await page.getByRole("button", { name: "Floor 1", exact: true }).click();
    await pause(page);
    await expect(page.locator("[data-map-zone-id]")).toHaveCount(4);
    await expect(
      page.locator('[data-map-zone-id][aria-pressed="true"]'),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Table view", exact: true }).click();
    await pause(page);
    await page.screenshot({ path: path.join(output, "mobile-list.png") });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBe(0);
  });
  await browser.close();
  fs.writeFileSync(
    path.join(output, "browser-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    "Desktop and mobile interaction checks passed; recordings saved.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
