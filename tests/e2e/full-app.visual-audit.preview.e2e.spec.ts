import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * An opt-in, full-application screenshot audit.
 *
 * It is intentionally not a pixel-baseline suite. `visual.preview.e2e.spec.ts`
 * owns reviewed light/dark baselines for representative screens; this file owns
 * the wider inspection corpus used by `docs/full-application-visual-qa-plan.md`.
 * A normal E2E run sees one skipped test and writes nothing. Run through the
 * repository server owner so preview data and build isolation stay honest:
 *
 *   VISUAL_AUDIT_DIR=artifacts/visual-audit/before \
 *     pnpm test:e2e -- full-app.visual-audit.preview.e2e.spec.ts \
 *     --project=preview-chromium
 */

const OUTPUT = process.env["VISUAL_AUDIT_DIR"];
const WAREHOUSE_STORAGE_KEY = "industrial-sas.warehouse";
const BANG_PU = "prv_wh_bangpoo";

const VIEWPORTS = [
  { name: "handheld-360", width: 360, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 900 },
] as const;

const LOCALES = ["th", "en"] as const;

const SCREENS = [
  { name: "sign-in", suffix: "/sign-in" },
  { name: "dashboard", suffix: "/dashboard" },
  { name: "inventory-balances", suffix: "/inventory/balances" },
  { name: "inventory-history", suffix: "/inventory/history" },
  { name: "items", suffix: "/master-data/items" },
  {
    name: "item-detail",
    suffix: "/master-data/items/prv_item_bolt_m8",
  },
  { name: "label-templates", suffix: "/master-data/label-templates" },
  { name: "locations", suffix: "/master-data/locations" },
  { name: "storage-classes", suffix: "/master-data/storage-classes" },
  { name: "suppliers", suffix: "/master-data/suppliers" },
  { name: "purchase-order-import", suffix: "/purchasing/import" },
  { name: "purchase-orders", suffix: "/purchasing/orders" },
  {
    name: "purchase-order-detail",
    suffix: "/purchasing/orders/prv_po_2601",
  },
  { name: "receiving", suffix: "/receiving" },
  { name: "receipt-detail", suffix: "/receiving/prv_rcpt_5001" },
  { name: "quality", suffix: "/quality" },
  { name: "putaway", suffix: "/putaway" },
  { name: "reports", suffix: "/reports" },
  { name: "setup", suffix: "/setup" },
  { name: "handheld-home", suffix: "/handheld" },
  { name: "handheld-inventory", suffix: "/handheld/inventory" },
  { name: "handheld-receive", suffix: "/handheld/receive" },
  { name: "handheld-quality", suffix: "/handheld/quality" },
  { name: "handheld-putaway", suffix: "/handheld/putaway" },
  { name: "not-found", suffix: "/visual-audit-not-found" },
] as const;

interface AuditEntry {
  readonly screenshot: string;
  readonly screen: string;
  readonly locale: string;
  readonly route: string;
  readonly viewport: string;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly horizontalOverflow: number;
  readonly overflowElements: readonly {
    readonly element: string;
    readonly left: number;
    readonly right: number;
  }[];
  readonly consoleErrors: readonly string[];
}

const consoleText = (message: ConsoleMessage): string =>
  `${message.type()}: ${message.text()}`;

async function ready(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.evaluate(async () => await document.fonts.ready);
  await page.addStyleTag({
    content: [
      "nextjs-portal, body > div:not([class]):not([id]) { display: none !important; }",
      "*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }",
    ].join("\n"),
  });
  await page.waitForTimeout(50);
}

test("captures every screen for visual analysis", async ({ page }) => {
  test.skip(
    OUTPUT === undefined,
    "VISUAL_AUDIT_DIR opts into the audit corpus",
  );
  test.setTimeout(30 * 60 * 1000);

  const root = resolve(OUTPUT ?? "artifacts/visual-audit/unused");
  mkdirSync(root, { recursive: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key ?? "", value ?? ""),
    [WAREHOUSE_STORAGE_KEY, BANG_PU],
  );

  const entries: AuditEntry[] = [];
  let currentConsoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      currentConsoleErrors.push(consoleText(message));
  });
  page.on("pageerror", (error) =>
    currentConsoleErrors.push(`pageerror: ${error.message}`),
  );

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const locale of LOCALES) {
      for (const screen of SCREENS) {
        currentConsoleErrors = [];
        const route = `/${locale}${screen.suffix}`;
        await page.goto(route);
        await ready(page);

        const screenshot = `${screen.name}--${locale}--${viewport.name}.png`;
        await page.screenshot({
          path: resolve(root, screenshot),
          fullPage: true,
          animations: "disabled",
          caret: "hide",
        });

        const geometry = await page.evaluate(() => {
          const viewportWidth = document.documentElement.clientWidth;
          const visible = (element: Element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0
            );
          };
          const label = (element: Element) => {
            const html = element as HTMLElement;
            const testId = html.dataset["testid"];
            if (testId !== undefined) return `[data-testid="${testId}"]`;
            if (html.id !== "") return `#${html.id}`;
            const classes = [...html.classList].slice(0, 2).join(".");
            return classes === ""
              ? html.tagName.toLowerCase()
              : `${html.tagName.toLowerCase()}.${classes}`;
          };
          const overflowElements = [...document.body.querySelectorAll("*")]
            .filter(visible)
            .map((element) => ({
              element,
              rect: element.getBoundingClientRect(),
            }))
            .filter(
              ({ rect }) => rect.left < -1 || rect.right > viewportWidth + 1,
            )
            .slice(0, 20)
            .map(({ element, rect }) => ({
              element: label(element),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
            }));

          return {
            horizontalOverflow: Math.max(
              0,
              document.documentElement.scrollWidth - viewportWidth,
            ),
            overflowElements,
          };
        });

        entries.push({
          screenshot,
          screen: screen.name,
          locale,
          route,
          viewport: viewport.name,
          width: viewport.width,
          height: viewport.height,
          title: await page.title(),
          horizontalOverflow: geometry.horizontalOverflow,
          overflowElements: geometry.overflowElements,
          consoleErrors: [...currentConsoleErrors],
        });
      }
    }
  }

  writeFileSync(
    resolve(root, "manifest.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2)}\n`,
    "utf8",
  );
  expect(entries).toHaveLength(
    SCREENS.length * LOCALES.length * VIEWPORTS.length,
  );
});
