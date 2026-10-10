import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { expect, expectNoAxeViolations, test } from "../support/fixtures";

/**
 * Adapted from scripts/storage-workspace-preview/{verify,responsive,camera}.mjs:
 * locator and geometry assertions instead of fixed sleeps, no video, and
 * failure-only diagnostics of synthetic fixtures. Fixture facts: floor 2 is
 * the approved PD plan (198 positions, 25 rows per page, 8 pages); floor 1 is
 * the four-location demo; DEMO-P-7 is the stored demo pallet.
 */

type Locale = "en" | "th";
const messages = (locale: Locale) =>
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).StorageLayouts;

const matrix: { locale: Locale; theme: "dark" | "light" }[] =
  process.env.WORKSPACE_FULL_MATRIX === "1"
    ? [
        { locale: "en", theme: "dark" },
        { locale: "en", theme: "light" },
        { locale: "th", theme: "dark" },
        { locale: "th", theme: "light" },
      ]
    : [
        { locale: "en", theme: "dark" },
        { locale: "th", theme: "dark" },
      ];

async function open(page: Page, query: string, ready = "[data-map-zone-id]") {
  await page.goto(`/?${query}`);
  await expect(page.locator(ready).first()).toBeVisible();
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function workspaceControls(page: Page) {
  // Controls follow the actual workspace width; a desktop device can still
  // have a narrow workspace after the surrounding page padding.
  const width = await page
    .locator("[data-workspace-toolbar]")
    .evaluate((toolbar) => toolbar.parentElement!.parentElement!.clientWidth);
  const canSplit = width >= 1100;
  await expect(
    page.getByRole("button", { name: "Split view", exact: true }),
  ).toHaveCount(canSplit ? 1 : 0);
  return { canSplit, compactInspector: width < 851 };
}

for (const { locale, theme } of matrix) {
  test.describe(`workspace list (${locale}, ${theme})`, () => {
    test("pages, searches, selects and shows the selection on the map", async ({
      page,
      isMobile,
    }) => {
      const m = messages(locale);
      await open(
        page,
        `panel=list&locale=${locale}`,
        "[data-workspace-location-list]",
      );
      if (theme === "light") {
        await page.getByRole("button", { name: "Light / dark" }).click();
        await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
      }
      const rows = page.locator("[data-location-row]");
      await expect(rows).toHaveCount(25);

      await page
        .getByRole("button", { name: m.locationTable.next, exact: true })
        .click();
      const first = rows.first();
      await expect(
        isMobile ? first : first.getByRole("button"),
      ).toHaveAttribute("aria-label", /PD-L2-11/);

      await page.getByRole("searchbox").fill("PD-L1-8");
      await expect(rows).toHaveCount(1);
      await expect(
        page.getByRole("button", {
          name: m.workspace.clearSearch,
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: m.locationTable.next, exact: true }),
      ).toHaveCount(0);

      const geometry = await page.evaluate(() => {
        const toolbar = document.querySelector("[data-workspace-toolbar]")!;
        const row = document.querySelector("[data-location-row]")!;
        const scroll = document.querySelector("[data-location-scroll]")!;
        const footer = document.querySelector(
          "[data-workspace-location-list] nav",
        )!;
        return {
          workspace:
            toolbar.parentElement!.parentElement!.getBoundingClientRect()
              .height,
          row: row.getBoundingClientRect().height,
          footerGap:
            footer.getBoundingClientRect().top -
            scroll.getBoundingClientRect().bottom,
        };
      });
      expect(Math.abs(geometry.footerGap)).toBeLessThan(2);
      if (isMobile) {
        expect(geometry.workspace).toBeLessThan(260);
        expect(geometry.row).toBeLessThanOrEqual(56);
      }
      expect(await overflow(page)).toBe(0);
      await expectNoAxeViolations(page, "main");

      await (
        isMobile ? rows.first() : rows.first().getByRole("button")
      ).click();
      await expect(
        page.locator("[data-inline-location-details]"),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: m.workspace.showOnMap, exact: true })
        .click();
      await expect(
        page.locator('[data-map-zone-id="PD-L1-8"]'),
      ).toHaveAttribute("aria-pressed", "true");

      await page
        .getByRole("button", { name: m.floorSelector, exact: true })
        .click();
      await expect(
        page.getByRole("navigation", { name: m.floorSelector, exact: true }),
      ).toHaveCount(1);
      await page
        .getByRole("button", {
          name: m.floor.replace("{floor}", "1"),
          exact: true,
        })
        .click();
      await expect(page.locator("[data-map-zone-id]")).toHaveCount(4);
      await expect(
        page.locator('[data-map-zone-id][aria-pressed="true"]'),
      ).toHaveCount(0);
      expect(await overflow(page)).toBe(0);
    });
  });
}

test.describe("workspace map and table (English, desktop)", () => {
  test.skip(
    ({ isMobile }) => isMobile,
    "These cases exercise the desktop table layout.",
  );

  test("switches views, keeps the selection, filters and handles empty results", async ({
    page,
  }) => {
    await open(page, "locale=en");
    const { canSplit, compactInspector } = await workspaceControls(page);
    await expect(page.locator("[data-map-zone-id]")).toHaveCount(198);
    await expect(page.getByRole("table")).toHaveCount(0);

    await page.getByRole("button", { name: "Table view", exact: true }).click();
    const scroll = page.locator("[data-location-scroll]");
    await scroll.evaluate((element) => (element.scrollTop = 500));
    // Sticky header: the table head stays aligned with the scroll viewport.
    await expect
      .poll(async () => {
        const [body, head] = await Promise.all([
          scroll.boundingBox(),
          page.locator("thead").boundingBox(),
        ]);
        return Math.abs((head?.y ?? 0) - (body?.y ?? 99));
      })
      .toBeLessThan(3);
    await scroll.evaluate((element) => (element.scrollTop = 0));
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 2 / 8")).toBeVisible();

    await page
      .getByRole("button", {
        name: "Select location PD-L3-11 · PD-L3-11",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Map view", exact: true }).click();
    const selected = page.locator('[data-map-zone-id="PD-L3-11"]');
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    const details = page.getByRole("button", {
      name: "PD-L3-11 · Location details",
      exact: true,
    });
    if (compactInspector) {
      await expect(
        page.getByRole("button", { name: "Hide details", exact: true }),
      ).toHaveCount(0);
      await details.click();
      const dialog = page.getByRole("dialog", {
        name: "Location details",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await expect(dialog).toBeHidden();
    } else {
      await page
        .getByRole("button", { name: "Hide details", exact: true })
        .click();
    }
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await details.click();
    await page
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
    await expect(selected).toHaveAttribute("aria-pressed", "false");

    await page
      .getByRole("button", {
        name: canSplit ? "Split view" : "Table view",
        exact: true,
      })
      .click();
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("button", { name: "Filter locations" }).click();
    await page.getByRole("button", { name: "Stored", exact: true }).click();
    await page.keyboard.press("Escape");
    const rows = page.locator("tbody tr[data-location-row]");
    await expect(rows).toHaveCount(1);
    await page.getByRole("searchbox").fill("DEMO-P-7");
    await expect(rows).toHaveCount(1);
    await page.getByRole("searchbox").fill("no-matches");
    await expect(page.getByText("No storage locations match")).toBeVisible();
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();

    await page.getByRole("button", { name: "Map view", exact: true }).click();
    await page.getByRole("button", { name: "3D view", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "2D plan", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "2D plan", exact: true }).click();
    expect(await overflow(page)).toBe(0);
  });

  test("keeps the camera centre across panels and commits a drag once", async ({
    page,
  }) => {
    await open(page, "fixture=empty&locale=en");
    const { canSplit } = await workspaceControls(page);
    await expect(page.locator("[data-map-zone-id]")).toHaveCount(198);
    const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
    while (await zoom.isEnabled()) await zoom.click();

    const map = page.locator('svg[aria-label="Interactive floor map"]');
    const centre = () =>
      map.evaluate((svg) => {
        const group = svg.querySelector(":scope > g") as SVGGraphicsElement;
        const floor = group.querySelector(
          ":scope > polygon",
        ) as SVGGraphicsElement;
        const box = svg.getBoundingClientRect();
        const point = new DOMPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        ).matrixTransform(group.getScreenCTM()!.inverse());
        const bounds = floor.getBBox();
        return {
          x: (point.x - bounds.x) / bounds.width,
          y: (point.y - bounds.y) / bounds.height,
        };
      });
    // Wait until the zoom transition settles before measuring.
    let previous = await centre();
    await expect
      .poll(async () => {
        const current = await centre();
        const stable =
          Math.abs(current.x - previous.x) < 1e-6 &&
          Math.abs(current.y - previous.y) < 1e-6;
        previous = current;
        return stable;
      })
      .toBe(true);

    const box = (await map.boundingBox())!;
    const beforeDrag = await centre();
    await page.evaluate(() => {
      (
        window as unknown as { __storageWorkspaceProfile: unknown[] }
      ).__storageWorkspaceProfile = [];
    });
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 50; step += 1) {
      await page.mouse.move(x + (100 * step) / 50, y + (55 * step) / 50);
    }
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __storageWorkspaceProfile: { phase: string }[];
              }
            ).__storageWorkspaceProfile.filter(
              (entry) => entry.phase === "update",
            ).length,
        ),
      )
      .toBe(1);

    // Let both queued animation frames commit before checking the final count.
    // The centre must move too, otherwise a no-op drag could satisfy the test.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __storageWorkspaceProfile: { phase: string }[];
            }
          ).__storageWorkspaceProfile.filter(
            (entry) => entry.phase === "update",
          ).length,
      ),
    ).toBe(1);

    const original = await centre();
    expect(
      Math.max(
        Math.abs(original.x - beforeDrag.x),
        Math.abs(original.y - beforeDrag.y),
      ),
    ).toBeGreaterThan(0.0001);
    const views = canSplit
      ? ["Split view", "Map view", "Table view", "Map view"]
      : ["Table view", "Map view", "Table view", "Map view"];
    for (const view of views) {
      await page.getByRole("button", { name: view, exact: true }).click();
      if (view === "Table view") continue;
      await expect
        .poll(async () => {
          const current = await centre();
          return Math.max(
            Math.abs(current.x - original.x),
            Math.abs(current.y - original.y),
          );
        })
        .toBeLessThan(0.00001);
    }
  });
});
