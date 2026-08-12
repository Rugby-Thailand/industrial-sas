import { expect, test, type Page } from "@playwright/test";

/**
 * Visual regression for the two screens the component migration changed most.
 *
 * Every other suite here asserts behaviour, and behaviour is the right thing to
 * assert nearly all of the time. This one exists because the defect that started
 * the migration was invisible to all of them: a native `<select>` on
 * `/th/dashboard` was reachable, labelled, keyboard-operable, and submitted the
 * right value — and drew a white operating-system menu on a dark screen. Every
 * functional test passed while the screen was unusable in a dim warehouse.
 *
 * So the axes are the ones that failure lived on:
 *
 * - **Colour scheme**, because that is where the defect was. The application has
 *   no theme toggle; it follows the device, which is what `emulateMedia` sets.
 * - **Locale**, because Thai is the layout baseline (`ADR-0010` §5). Thai spaces
 *   separate phrases rather than words and its combining marks change line
 *   height, so a card that fits in English is not known to fit in Thai.
 * - **Width**, at 360 (the smallest handheld the product targets), 768, and
 *   1280 — the two sides of the navigation-rail breakpoint plus the width a
 *   supervisor actually uses.
 *
 * ### Baselines are per platform, on purpose
 *
 * Playwright suffixes each snapshot with the operating system it was recorded
 * on, and that is kept rather than worked around: Linux and macOS rasterise
 * Thai glyphs differently, so a single shared baseline would either fail on
 * every machine that did not record it or need a tolerance so wide it stopped
 * catching anything. A platform with no baseline yet records one with
 * `pnpm test:e2e --update-snapshots`, and that file is committed alongside the
 * others.
 */

const WAREHOUSE_STORAGE_KEY = "industrial-ssa.warehouse";
const BANG_PU = "prv_wh_bangpoo";

const VIEWPORTS = [
  { name: "handheld-360", width: 360, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 900 },
] as const;

const SCHEMES = ["light", "dark"] as const;
const LOCALES = ["th", "en"] as const;

const SCREENS = [
  { name: "dashboard", path: (locale: string) => `/${locale}/dashboard` },
  /*
   * The representative form. Master-data items is the densest one in the
   * application — text, numeric, and select fields together — so it is where a
   * regression in the shared field primitives shows up first.
   */
  {
    name: "item-form",
    path: (locale: string) => `/${locale}/master-data/items`,
  },
] as const;

/**
 * A warehouse, chosen before the first paint.
 *
 * Seeded into storage rather than clicked, because this suite is about how the
 * screens look once an operator is working — and the "no warehouse selected"
 * state is a different screen that the behavioural suites already cover.
 */
async function seedWarehouse(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key ?? "", value ?? "");
    },
    [WAREHOUSE_STORAGE_KEY, BANG_PU],
  );
}

for (const scheme of SCHEMES) {
  for (const locale of LOCALES) {
    for (const viewport of VIEWPORTS) {
      for (const screen of SCREENS) {
        test(`${screen.name} renders consistently in ${locale} at ${viewport.name} (${scheme})`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          });
          await seedWarehouse(page);
          await page.goto(screen.path(locale));

          // The heading is the whole page's readiness signal: it is server
          // rendered, so waiting for it means the shell and its chrome are
          // laid out before anything is captured.
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          // The banner is on every preview screen, and waiting for it means the
          // client tree has hydrated — otherwise the rail can still be settling.
          await expect(page.getByTestId("preview-banner")).toBeVisible();

          /*
           * The **shell**, not the page.
           *
           * The preview server is a `next dev`, and Next paints its own
           * development indicator over the corner of the viewport — bottom-left,
           * on top of the navigation rail. It is dev-only chrome that no deployed
           * build has, it appears a beat after hydration, and a full-page capture
           * therefore bakes a badge into the baseline that will move the next
           * time Next restyles it. Screenshotting the application's own root
           * excludes it by construction rather than by a CSS override that has
           * to keep up with whatever element Next renders into.
           *
           * The root still contains everything this suite is about: the preview
           * banner, the header, both selects, the navigation, and the whole main
           * region, at its full scroll height.
           */
          const shell = page.locator('[data-slot="sidebar-wrapper"]');

          /*
           * …and the indicator is hidden as well, because it is `fixed` and a
           * fixed overlay is painted over whatever it sits above — including an
           * element capture. Next mounts it into an unclassed `body > div`
           * sibling of the application root, which is what this selects; every
           * element the application renders carries a class or a data slot.
           */
          await page.addStyleTag({
            content:
              "nextjs-portal, body > div:not([class]):not([id]) { display: none !important; }",
          });

          await expect(shell).toHaveScreenshot(
            `${screen.name}-${locale}-${viewport.name}-${scheme}.png`,
            {
              animations: "disabled",
              caret: "hide",
              /*
               * Sub-pixel text rendering varies between runs on the same
               * machine. The tolerance is small enough that a colour-scheme
               * regression — the failure this suite exists for — moves far more
               * pixels than it allows.
               */
              maxDiffPixelRatio: 0.01,
            },
          );
        });
      }
    }
  }
}
