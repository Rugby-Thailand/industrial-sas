import { readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin =
  "/en/master-data/storage-layouts?floor=1&view=storage&q=A%20B&tag=1&tag=2#map";
const home = "/en/dashboard";
const storage = "/en/master-data/storage-layouts";
const homeWithQuery =
  "/en/dashboard?source=A%20B&tag=1&tag=2#quick-menu-heading";
const english = JSON.parse(readFileSync("messages/en.json", "utf8"));
const thai = JSON.parse(readFileSync("messages/th.json", "utf8"));

function quickMenu(page: Page) {
  return page.getByRole("region", {
    name: english.Home.quickMenus,
    exact: true,
  });
}

function editor(page: Page) {
  return page.getByRole("dialog", {
    name: english.Home.customizeTitle,
    exact: true,
  });
}

async function ready(page: Page) {
  await expect(page.getByTestId("navigation-ready")).toHaveAttribute(
    "data-ready",
    "true",
  );
}

async function clickStorageHomeLink(page: Page) {
  const navigation = page.getByRole("navigation", {
    name: english.Navigation.primary,
    exact: true,
  });
  const menuOpener = page.getByRole("button", {
    name: english.Navigation.openMenu,
    exact: true,
  });
  if (await menuOpener.isVisible()) await menuOpener.click();
  await navigation
    .getByRole("link", { name: english.Navigation.home, exact: true })
    .click();
  await expect(page).toHaveURL(home);
}

async function openHomeFromStorage(page: Page) {
  await page.goto(origin);
  await ready(page);
  await clickStorageHomeLink(page);
}

async function customize(page: Page) {
  await quickMenu(page)
    .getByRole("button", { name: english.Home.customize, exact: true })
    .click();
  await expect(editor(page)).toBeVisible();
}

test("opens the Android launch URL as a direct Home hub with an unread badge", async ({
  page,
}) => {
  const manifest = JSON.parse(
    readFileSync("public/manifest.webmanifest", "utf8"),
  );
  expect(manifest.start_url).toBe("/th/dashboard");
  const response = await page.goto(manifest.start_url);
  expect(response?.status()).toBe(200);
  await ready(page);
  await expect(
    page.getByRole("heading", { name: thai.Home.title, level: 1 }),
  ).toBeVisible();
  const badge = thai.Home.unread.replace("{count}", "2");
  await expect(
    page.getByRole("link", {
      name: thai.Navigation.hrNotifications + ", " + badge,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: thai.App.back, exact: true }),
  ).toHaveCount(0);
});

test("shows localized Home setup when the backend is unavailable", async ({
  page,
}) => {
  await page.goto("/th/dashboard?env=backend-unavailable");
  await expect(
    page.getByRole("heading", { name: thai.Home.title, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(thai.Home.setupRequired, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: thai.Home.customize, exact: true }),
  ).toHaveCount(0);
});

test("Home tile history restores the exact URL through header Back, Forward and reload", async ({
  page,
}) => {
  await page.goto(homeWithQuery);
  await ready(page);
  await quickMenu(page)
    .getByRole("link", { name: english.Navigation.storageLayouts, exact: true })
    .click();
  await expect(page).toHaveURL(storage);
  await page
    .getByRole("button", { name: english.App.back, exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(homeWithQuery);
  await page.goForward();
  await expect(page).toHaveURL(storage);
  await page.reload();
  await ready(page);
  await page.goBack();
  await expect(page).toHaveURL(homeWithQuery);
  await expect(editor(page)).toHaveCount(0);
});

test("Home Customize Cancel retains edits on Keep and consumes its entry on Discard before the next Back", async ({
  page,
}) => {
  await openHomeFromStorage(page);
  await customize(page);
  const pin = editor(page).getByRole("button", {
    name: "Pin Scan job tickets",
    exact: true,
  });
  await pin.focus();
  await page.keyboard.press("Enter");
  await expect(
    editor(page).getByRole("button", {
      name: "Unpin Scan job tickets",
      exact: true,
    }),
  ).toBeFocused();
  await expect(editor(page).locator("[aria-live=polite]")).toHaveText(
    "Pinned Scan job tickets.",
  );
  const moveUp = editor(page).getByRole("button", {
    name: "Move Scan job tickets up",
    exact: true,
  });
  await moveUp.focus();
  await page.keyboard.press("Enter");
  await expect(moveUp).toBeFocused();
  await expect(editor(page).locator("[aria-live=polite]")).toHaveText(
    "Moved Scan job tickets to position 2.",
  );
  const cancel = editor(page).getByRole("button", {
    name: english.Home.cancel,
    exact: true,
  });
  await cancel.click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    editor(page).getByRole("button", {
      name: "Unpin Scan job tickets",
      exact: true,
    }),
  ).toBeVisible();
  await cancel.click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(editor(page)).toHaveCount(0);
  await expect(
    quickMenu(page).getByRole("link", {
      name: english.Navigation.jobScan,
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(origin);
});

test("Home Customize protects a pending save and consumes its entry before the next Back", async ({
  page,
}) => {
  await openHomeFromStorage(page);
  await customize(page);
  const editorUrl = page.url();
  await editor(page)
    .getByRole("button", { name: "Unpin Buildings & spots", exact: true })
    .click();

  let releaseSave: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/fixture-save", async (route) => {
    await hold;
    await route.continue();
  });
  const write = page.waitForRequest(
    (request) =>
      request.url().endsWith("/fixture-save") && request.method() === "POST",
  );
  await editor(page)
    .getByRole("button", { name: english.Home.save, exact: true })
    .click();
  await write;
  try {
    await page.goBack();
    await expect(page).toHaveURL(editorUrl);
    await expect(editor(page)).toBeVisible();
  } finally {
    releaseSave();
  }
  await expect(editor(page)).toHaveCount(0);
  await expect(page).toHaveURL(home);
  await expect(
    quickMenu(page).getByRole("link", {
      name: english.Navigation.storageLayouts,
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await ready(page);
  await expect(
    quickMenu(page).getByRole("link", {
      name: english.Navigation.storageLayouts,
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(origin);
  await page.goForward();
  await expect(page).toHaveURL(home);
  await expect(editor(page)).toHaveCount(0);
});

test("Home All menus opens the mobile drawer and native Back closes Drawer and Search", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(homeWithQuery);
  await ready(page);
  const allMenus = quickMenu(page).getByRole("button", {
    name: english.Home.allMenus,
    exact: true,
  });
  const drawer = page.getByRole("dialog", {
    name: english.Navigation.primary,
    exact: true,
  });
  await allMenus.click();
  await expect(drawer).toBeVisible();
  await expect
    .poll(() =>
      drawer
        .getByRole("navigation")
        .evaluate((nav) => nav.contains(document.activeElement)),
    )
    .toBe(true);
  await page.goBack();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(homeWithQuery);

  await allMenus.click();
  await drawer
    .getByRole("button", { name: english.Search.triggerLabel, exact: true })
    .click();
  const search = page.getByRole("dialog", {
    name: english.Search.title,
    exact: true,
  });
  await expect(search).toBeVisible();
  await page.goBack();
  await expect(search).toHaveCount(0);
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(homeWithQuery);
});

test("Storage to Home and back retains the exact Storage URL and computed workspace styles", async ({
  page,
}) => {
  await page.goto(origin);
  await ready(page);
  const workspace = page.getByRole("heading", {
    name: "Storage editor fixture",
    level: 1,
  });
  const workspaceStyles = () =>
    workspace.evaluate((element) => {
      const {
        display,
        fontSize,
        lineHeight,
        color,
        backgroundColor,
        borderRadius,
      } = getComputedStyle(element);
      return {
        display,
        fontSize,
        lineHeight,
        color,
        backgroundColor,
        borderRadius,
      };
    });
  const baseline = await workspaceStyles();
  expect(baseline.fontSize).toBe("20px");
  await clickStorageHomeLink(page);
  await page.goBack();
  await expect(page).toHaveURL(origin);
  await expect(workspace).toBeVisible();
  expect(await workspaceStyles()).toEqual(baseline);
});

test("Home and its Customize sheet pass axe in light and dark themes", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Run axe in desktop and mobile Chromium",
  );
  await page.goto(home);
  await ready(page);
  const violations = async () => {
    // Sample contrast after the Sheet's entrance and its backdrop settle.
    await page.evaluate(async () => {
      const modalParts = document.querySelectorAll(
        '[data-slot="sheet-overlay"], [data-slot="sheet-content"]',
      );
      await Promise.allSettled(
        Array.from(modalParts).flatMap((part) =>
          part.getAnimations().map((animation) => animation.finished),
        ),
      );
    });
    return (await new AxeBuilder({ page }).analyze()).violations;
  };
  await expect(quickMenu(page)).toBeVisible();
  expect(await violations()).toEqual([]);
  await customize(page);
  expect(await violations()).toEqual([]);
  await editor(page)
    .getByRole("button", { name: english.Home.cancel, exact: true })
    .click();
  await expect(editor(page)).toHaveCount(0);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  expect(await violations()).toEqual([]);
  await customize(page);
  expect(await violations()).toEqual([]);
});
