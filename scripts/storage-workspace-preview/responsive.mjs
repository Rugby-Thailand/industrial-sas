import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
const output = path.resolve("output/workspace-qa");
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const locale of ["en", "th"])
    for (const width of [320, 390, 768, 1440])
      for (const theme of ["dark", "light"]) {
        const messages = JSON.parse(
          fs.readFileSync(`messages/${locale}.json`, "utf8"),
        ).StorageLayouts;
        const context = await browser.newContext({
          viewport: { width, height: 900 },
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`http://127.0.0.1:3190/?panel=list&locale=${locale}`);
        await expect(
          page.locator("[data-workspace-location-list]"),
        ).toBeVisible();
        if (theme === "light")
          await page.getByRole("button", { name: "Light / dark" }).click();
        await expect(page.locator("[data-location-row]")).toHaveCount(25);
        await page
          .getByRole("button", {
            name: messages.locationTable.next,
            exact: true,
          })
          .click();
        const first = page.locator("[data-location-row]").first();
        await expect(
          width <= 580 ? first : first.getByRole("button"),
        ).toHaveAttribute("aria-label", /PD-L2-11/);
        await page.getByRole("searchbox").fill("PD-L1-8");
        await expect(page.locator("[data-location-row]")).toHaveCount(1);
        await expect(
          page.getByRole("button", {
            name: messages.workspace.clearSearch,
            exact: true,
          }),
        ).toHaveCount(1);
        await expect(
          page.getByRole("button", {
            name: messages.locationTable.next,
            exact: true,
          }),
        ).toHaveCount(0);
        const geometry = await page.evaluate(() => {
          const toolbar = document.querySelector("[data-workspace-toolbar]");
          const row = document.querySelector("[data-location-row]");
          const workspace = toolbar.parentElement.parentElement;
          const scroll = document.querySelector("[data-location-scroll]");
          const footer = document.querySelector(
            "[data-workspace-location-list] nav",
          );
          return {
            toolbar: toolbar.getBoundingClientRect().height,
            row: row.getBoundingClientRect().height,
            workspace: workspace.getBoundingClientRect().height,
            overflow: document.documentElement.scrollWidth - innerWidth,
            footerGap:
              footer.getBoundingClientRect().top -
              scroll.getBoundingClientRect().bottom,
          };
        });
        expect(geometry.overflow).toBe(0);
        expect(Math.abs(geometry.footerGap)).toBeLessThan(2);
        if (width === 390) {
          expect(geometry.workspace).toBeLessThan(260);
          expect(geometry.row).toBeLessThanOrEqual(56);
        }
        const violations = (
          await new AxeBuilder({ page })
            .include("main")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations;
        expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
        await page.screenshot({
          path: path.join(
            output,
            `compact-${locale}-${theme}-${width}-single.png`,
          ),
        });
        const selectedRow = page.locator("[data-location-row]").first();
        await (
          width <= 580 ? selectedRow : selectedRow.getByRole("button")
        ).click();
        await expect(
          page.locator("[data-inline-location-details]"),
        ).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page
          .getByRole("button", {
            name: messages.workspace.showOnMap,
            exact: true,
          })
          .click();
        await expect(
          page.locator('[data-map-zone-id="PD-L1-8"]'),
        ).toHaveAttribute("aria-pressed", "true");
        await page
          .getByRole("button", { name: messages.floorSelector, exact: true })
          .click();
        await expect(
          page.getByRole("navigation", {
            name: messages.floorSelector,
            exact: true,
          }),
        ).toHaveCount(1);
        await page
          .getByRole("button", {
            name: messages.floor.replace("{floor}", "1"),
            exact: true,
          })
          .click();
        await expect(page.locator("[data-map-zone-id]")).toHaveCount(4);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBe(0);
        expect(errors).toEqual([]);
        results.push({
          locale,
          width,
          theme,
          ...geometry,
          violations: violations.length,
          errors,
        });
        await context.close();
      }
  console.log(`${results.length} responsive/locale/theme cases passed.`);
} finally {
  await browser.close();
  fs.writeFileSync(
    path.join(output, "responsive-results.json"),
    JSON.stringify(results, null, 2),
  );
}
