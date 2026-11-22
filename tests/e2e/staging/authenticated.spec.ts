import { readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import { expect, test } from "../support/release-fixtures";
import {
  expectDenied,
  runStorageFlow,
  type Execute,
  type FlowResult,
} from "./flows";
import {
  convexCloudUrl,
  organizationName,
  readReadyFixtureState,
} from "./support";

/**
 * Trusted staging: real Clerk (test instance) sign-in, organization and
 * warehouse context, layout write/readback, pallet placement and move, and
 * tenant/warehouse denials against the staging Convex deployment. Serial,
 * one worker, nothing recorded (see playwright.staging.config.ts).
 */

test.describe.configure({ mode: "serial" });

const messages = JSON.parse(readFileSync("messages/th.json", "utf8"));
const th = messages.StorageLayouts;
const WAREHOUSE_KEY = "industrial-sas.warehouse";
let completedFlow: FlowResult | undefined;

async function signIn(page: Page, returnTo?: string) {
  const state = readReadyFixtureState();
  let phase = "STAGING_SIGN_IN_TESTING_TOKEN_FAILED";
  try {
    await setupClerkTestingToken({ page });
    phase = "STAGING_SIGN_IN_NAVIGATION_FAILED";
    if (returnTo) {
      await page.goto(returnTo);
      await expect
        .poll(() => {
          const url = new URL(page.url());
          return [url.pathname, url.searchParams.get("returnTo")];
        })
        .toEqual(["/th/sign-in", returnTo]);
    } else {
      await page.goto("/th/sign-in");
    }
    phase = "STAGING_SIGN_IN_LOAD_FAILED";
    await clerk.loaded({ page });
    phase = "STAGING_SIGN_IN_TICKET_FAILED";
    await clerk.signIn({ page, emailAddress: state.managerEmail });
    phase = "STAGING_SIGN_IN_IDENTITY_UNCONFIRMED";
    expect(await page.evaluate(() => window.Clerk.user?.id)).toBe(
      state.clerkUserId,
    );
    if (returnTo) {
      phase = "STAGING_SIGN_IN_CLEAR_ORGANIZATION_FAILED";
      await page.evaluate(async () => {
        await window.Clerk.setActive({ organization: null });
      });
      await page.goto(returnTo);
      return state;
    }
    phase = "STAGING_SIGN_IN_ORGANIZATION_FAILED";
    await page.evaluate(async (organization) => {
      await window.Clerk.setActive({ organization });
    }, state.clerkOrganizationId);
    phase = "STAGING_SIGN_IN_WAREHOUSE_CACHE_FAILED";
    await page.evaluate(
      ([key, warehouse]) => window.localStorage.setItem(key!, warehouse!),
      [WAREHOUSE_KEY, state.runWarehouseId],
    );
    return state;
  } catch {
    // The sensitive reporter accepts fixed codes, never raw auth errors.
    throw new Error(phase);
  }
}

async function convexAs(page: Page): Promise<Execute> {
  // Every navigation creates a new Clerk client. Route/server assertions can
  // pass before its active session has hydrated in the browser.
  await clerk.loaded({ page });
  await expect
    .poll(() => page.evaluate(() => Boolean(window.Clerk.session)), {
      timeout: 20_000,
      message: "STAGING_ACTIVE_CLERK_SESSION_UNCONFIRMED",
    })
    .toBe(true);
  const token = await page.evaluate(
    async () =>
      (await window.Clerk.session?.getToken({ template: "convex" })) ?? null,
  );
  expect(Boolean(token), "STAGING_CONVEX_TOKEN_UNAVAILABLE").toBe(true);
  const client = new ConvexHttpClient(convexCloudUrl(), { logger: false });
  client.setAuth(token!);
  return async (kind, name, args) =>
    kind === "query"
      ? await client.query(makeFunctionReference<"query">(name), args)
      : await client.mutation(makeFunctionReference<"mutation">(name), args);
}

test("signs in and resolves the organization and warehouse context", async ({
  page,
}) => {
  const state = await signIn(page);
  let phase = "STAGING_AUTH_CONTEXT_NAVIGATION_FAILED";
  try {
    await page.goto("/th/master-data/storage-layouts");
    phase = "STAGING_AUTH_CONTEXT_PAGE_UNCONFIRMED";
    await expect(page).toHaveURL(/\/th\/master-data\/storage-layouts$/);
    await expect(page.getByTestId("not-found")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    phase = "STAGING_AUTH_CONTEXT_QUERY_FAILED";
    const execute = await convexAs(page);
    const workspace = (await execute(
      "query",
      "workspace/current:readCurrent",
      {},
    )) as {
      ok: boolean;
      value: {
        organization: { name: string };
        warehouses: { id: string; code: string }[];
      };
    };
    phase = "STAGING_AUTH_CONTEXT_RESULT_UNCONFIRMED";
    expect(workspace.ok).toBe(true);
    expect(workspace.value.organization.name).toBe(
      organizationName(state.runId, "primary"),
    );
    // Scoped membership: the run warehouse only, never the forbidden one.
    expect(workspace.value.warehouses.map(({ id }) => id)).toEqual([
      state.runWarehouseId,
    ]);
  } catch {
    throw new Error(phase);
  }
});

test("creates a building through the UI and reads it back", async ({
  page,
}) => {
  const state = await signIn(page);
  const code = `E2E-${state.runId.toUpperCase()}-UI`.slice(0, 64);
  await page.goto("/th/master-data/storage-layouts/new");
  await page.getByRole("textbox", { name: th.code, exact: true }).fill(code);
  await page
    .getByRole("textbox", { name: th.name, exact: true })
    .fill(`CI E2E UI ${state.runId}`);
  await page.getByRole("button", { name: th.create }).click();
  await expect(page).toHaveURL(
    /\/th\/master-data\/storage-layouts\/[a-z0-9]+$/,
  );
  await expect(
    page.getByText(`CI E2E UI ${state.runId}`).first(),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByText(`CI E2E UI ${state.runId}`).first(),
  ).toBeVisible();
});

test("edits a layout, places and moves a pallet, and shows the result", async ({
  page,
}) => {
  const state = await signIn(page);
  const execute = await convexAs(page);
  const result = await runStorageFlow(execute, {
    runId: state.runId,
    warehouseId: state.runWarehouseId,
  });
  completedFlow = result;

  await page.goto(`/th/master-data/storage-layouts/${result.buildingId}`);
  await expect(page.getByText(result.buildingName).first()).toBeVisible();
  await expect(page.getByText(result.targetZoneCode).first()).toBeAttached();
});

test("Home preserves the localized return URL and updates unread badges after a second-tab read", async ({
  page,
  context,
}) => {
  const target = "/th/dashboard?source=home%20staging&tag=1&tag=2";
  await page.emulateMedia({ colorScheme: "light" });
  const fixture = await signIn(page, target);
  let phase = "STAGING_HOME_ORGANIZATION_PICKER_FAILED";
  try {
    await expect(page.getByTestId("organization-required")).toBeVisible();
    await page
      .getByText(organizationName(fixture.runId, "primary"), { exact: true })
      .click();
    await expect
      .poll(() => {
        const { pathname, search } = new URL(page.url());
        return pathname + search;
      })
      .toBe(target);

    phase = "STAGING_HOME_BADGE_INITIAL_FAILED";
    const menus = page.getByRole("region", {
      name: messages.Home.quickMenus,
      exact: true,
    });
    const notificationTile = (count: number) =>
      menus.getByRole("link", {
        name:
          messages.Navigation.hrNotifications +
          ", " +
          messages.Home.unread.replace("{count}", String(count)),
        exact: true,
      });
    const execute = await convexAs(page);
    const unread = (await execute("query", "hr/notifications:unreadSummary", {
      expectedClerkScope: {
        clerkOrgId: fixture.clerkOrganizationId,
        clerkUserId: fixture.clerkUserId,
      },
      readRetryAttempt: 0,
    })) as { ok: boolean; value?: { total: number } };
    expect(unread.ok).toBe(true);
    const initial = unread.value?.total ?? 0;
    expect(initial).toBeGreaterThan(1);
    await expect(notificationTile(initial)).toBeVisible();

    phase = "STAGING_HOME_MARK_ONE_FAILED";
    const secondTab = await context.newPage();
    try {
      await setupClerkTestingToken({ page: secondTab });
      await secondTab.goto("/th/hr/notifications");
      await secondTab
        .getByRole("button", {
          name: messages.Hr.notifications.markRead,
          exact: true,
        })
        .first()
        .click();
      phase = "STAGING_HOME_BADGE_LIVE_UPDATE_FAILED";
      await expect(notificationTile(initial - 1)).toBeVisible();
    } finally {
      await secondTab.close();
    }

    phase = "STAGING_HOME_LIGHT_ACCESSIBILITY_FAILED";
    const checkAccessibility = async () => {
      const report = await new AxeBuilder({ page }).analyze();
      expect(report.violations.map(({ id }) => id)).toEqual([]);
    };
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    await checkAccessibility();
    phase = "STAGING_HOME_DARK_ACCESSIBILITY_FAILED";
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await checkAccessibility();
  } catch {
    throw new Error(phase);
  }
});

test("is denied in the forbidden warehouse and the other tenant", async ({
  page,
}) => {
  const state = await signIn(page);
  const execute = await convexAs(page);
  const attempt = (warehouseId: string) => () =>
    execute("mutation", "storageLayouts/writes:createStorageBuilding", {
      warehouseId,
      requestId: `${state.runId}-denied`,
      code: "E2E-DENIED",
      name: "CI E2E denied",
      widthMm: 1_000,
      depthMm: 1_000,
      defaultFloorHeightMm: 3_000,
      floorCount: 1,
    });
  expect(
    await expectDenied(
      "forbidden warehouse",
      attempt(state.forbiddenWarehouseId),
    ),
  ).toBe("WAREHOUSE_OUT_OF_SCOPE");
  expect(
    await expectDenied("other tenant", attempt(state.otherTenantWarehouseId)),
  ).toBe("WAREHOUSE_UNKNOWN");

  expect(completedFlow, "owned pallet flow completed").toBeDefined();
  const pallet = (await execute("query", "finishedGoods/workflow:getPallet", {
    warehouseId: state.runWarehouseId,
    palletId: completedFlow!.palletId,
  })) as {
    ok: boolean;
    value: { placement?: { _id: string; zoneId: string } };
  };
  expect(pallet.ok).toBe(true);
  expect(pallet.value.placement).toBeDefined();
  const moveAttempt = (warehouseId: string) => () =>
    execute("mutation", "finishedGoods/workflow:reserveMove", {
      warehouseId,
      palletId: completedFlow!.palletId,
      requestId: `${state.runId}-move-denied`,
      zoneId: pallet.value.placement!.zoneId,
      expectedSourcePlacementId: pallet.value.placement!._id,
      xMm: 0,
      yMm: 0,
      rotation: 0,
    });
  expect(
    await expectDenied(
      "forbidden move",
      moveAttempt(state.forbiddenWarehouseId),
    ),
  ).toBe("WAREHOUSE_OUT_OF_SCOPE");
  expect(
    await expectDenied(
      "other tenant move",
      moveAttempt(state.otherTenantWarehouseId),
    ),
  ).toBe("WAREHOUSE_UNKNOWN");

  // The browser cannot select the forbidden warehouse either.
  await page.evaluate(
    ([key, warehouse]) => window.localStorage.setItem(key!, warehouse!),
    [WAREHOUSE_KEY, state.forbiddenWarehouseId],
  );
  await page.goto("/th/master-data/storage-layouts");
  await expect(page.getByText("E2E-FORBIDDEN")).toHaveCount(0);
});

test("rejects an invalid JWT at the real Convex boundary", async () => {
  const client = new ConvexHttpClient(convexCloudUrl(), { logger: false });
  client.setAuth("synthetic-invalid-jwt");
  await expect(
    client.query(
      makeFunctionReference<"query">("workspace/current:readCurrent"),
      {},
    ),
  ).rejects.toThrow(/auth|token|jwt/i);
});

test("signing out returns private routes to sign-in", async ({
  page,
  sessionRevocation,
}) => {
  await signIn(page);
  let phase = "STAGING_SIGNOUT_NAVIGATION_FAILED";
  try {
    await page.goto("/th/master-data/storage-layouts");
    await clerk.loaded({ page });
    phase = "STAGING_SIGNOUT_ACTIVE_SESSION_UNCONFIRMED";
    await page.waitForFunction(() => Boolean(window.Clerk.session?.id));
    const sessionId = await page.evaluate(() => window.Clerk.session?.id ?? "");
    sessionRevocation.begin(sessionId);
    phase = "STAGING_SIGNOUT_SDK_FAILED";
    await clerk.signOut({ page });
    phase = "STAGING_SIGNOUT_SESSION_UNCONFIRMED";
    await page.waitForFunction(
      () =>
        Boolean(window.Clerk?.loaded) &&
        window.Clerk.session === null &&
        window.Clerk.user === null,
    );
    phase = "STAGING_SIGNOUT_REVISIT_FAILED";
    await page.goto("/th/master-data/storage-layouts");
    phase = "STAGING_SIGNOUT_ROUTE_UNCONFIRMED";
    await expect(page).toHaveURL(/\/th\/sign-in/);
    phase = "STAGING_SIGNOUT_WIDGET_UNCONFIRMED";
    await expect(
      page.locator(".cl-rootBox, .cl-signIn-root").first(),
    ).toBeVisible();
    sessionRevocation.confirm();
  } catch {
    throw new Error(phase);
  }
});
