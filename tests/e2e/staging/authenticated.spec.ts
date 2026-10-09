import { readFileSync } from "node:fs";

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

const th = JSON.parse(readFileSync("messages/th.json", "utf8")).StorageLayouts;
const WAREHOUSE_KEY = "industrial-sas.warehouse";
let completedFlow: FlowResult | undefined;

async function signIn(page: Page) {
  const state = readReadyFixtureState();
  await setupClerkTestingToken({ page });
  await page.goto("/th/sign-in");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: state.managerEmail });
  expect(await page.evaluate(() => window.Clerk.user?.id)).toBe(
    state.clerkUserId,
  );
  await page.evaluate(async (organization) => {
    await window.Clerk.setActive({ organization });
  }, state.clerkOrganizationId);
  await page.evaluate(
    ([key, warehouse]) => window.localStorage.setItem(key!, warehouse!),
    [WAREHOUSE_KEY, state.runWarehouseId],
  );
  return state;
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
  await page.goto("/th/master-data/storage-layouts");
  await expect(page).toHaveURL(/\/th\/master-data\/storage-layouts$/);
  await expect(page.getByTestId("not-found")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

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
  expect(workspace.ok).toBe(true);
  expect(workspace.value.organization.name).toBe(
    organizationName(state.runId, "primary"),
  );
  // Scoped membership: the run warehouse only, never the forbidden one.
  expect(workspace.value.warehouses.map(({ id }) => id)).toEqual([
    state.runWarehouseId,
  ]);
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

test("signing out returns private routes to sign-in", async ({ page }) => {
  await signIn(page);
  await page.goto("/th/master-data/storage-layouts");
  await clerk.signOut({ page });
  await page.goto("/th/master-data/storage-layouts");
  await expect(page).toHaveURL(/\/th\/sign-in/);
});
