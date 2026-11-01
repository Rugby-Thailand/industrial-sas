import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { test as base, expect, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import {
  HR_TEST_IDENTITY,
  loadHrEnvironment,
} from "../../../scripts/lib/hr-e2e-env.mjs";
import { readHrFixture } from "./setup";

export const test = base.extend({
  page: async ({ page }, runTest, info) => {
    let ownedSession: string | undefined;
    try {
      try {
        await setupClerkTestingToken({ page });
        await page.goto("/en/sign-in");
        await clerk.loaded({ page });
        await clerk.signIn({ page, emailAddress: HR_TEST_IDENTITY.email });
        expect(await page.evaluate(() => window.Clerk.user?.id)).toBe(
          HR_TEST_IDENTITY.userId,
        );
        ownedSession = await page.evaluate(() => window.Clerk.session?.id);
        await page.evaluate(async (organization) => {
          await window.Clerk.setActive({ organization });
        }, HR_TEST_IDENTITY.organizationId);
        await page.evaluate(
          (id) => localStorage.setItem("industrial-sas.warehouse", id),
          readHrFixture().warehouseId,
        );
      } catch {
        // Never print Clerk SDK errors that could contain a one-time ticket.
        throw new Error("HR_E2E_REAL_CLERK_SIGN_IN_FAILED");
      }
      await runTest(page);
    } finally {
      if (info.status !== info.expectedStatus && !page.isClosed()) {
        try {
          const navigation = await page.evaluate(() => ({
            path: location.pathname + location.search + location.hash,
            historyLength: history.length,
            historyStateKeys: Object.keys(history.state ?? {}),
          }));
          if (navigation.path.startsWith("/en/hr/"))
            await info.attach("navigation-failure", {
              body: JSON.stringify(navigation),
              contentType: "application/json",
            });
        } catch {
          /* Diagnostic capture must not replace the original failure. */
        }
      }
      if (ownedSession) {
        try {
          const env = loadHrEnvironment();
          await createClerkClient({
            secretKey: env.CLERK_SECRET_KEY,
          }).sessions.revokeSession(ownedSession);
        } catch {
          throw new Error("HR_E2E_OWNED_CLERK_SESSION_CLEANUP_FAILED");
        }
      }
    }
  },
});
export { expect };

/** Form disappearance precedes the owned browser traversal by a frame. */
export async function expectEmployeeList(page: Page, code: string) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/en/hr/employees" &&
      url.searchParams.get("q") === code &&
      !url.searchParams.has("mode") &&
      !url.searchParams.has("employee"),
  );
}

/** New active employees must choose masters once the organization has them. */
export async function chooseRequiredEmployment(page: Page) {
  const form = page.getByTestId("hr-employee-form");
  for (const [label, endpoint] of [
    [/^Department( \*)?$/, "hr/org:listDepartments"],
    [/^Position( \*)?$/, "hr/org:listPositions"],
  ] as const) {
    const control = form.getByLabel(label);
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeEnabled();
    const result = await (await convexAs(page)).query(endpoint);
    expect(result.ok).toBe(true);
    const active = result.value.items.find(
      (row: { status: string }) => row.status === "ACTIVE",
    );
    if (active) {
      await control.click();
      await page
        .getByRole("option", { name: active.name, exact: true })
        .click();
      await expect(control).toHaveText(active.name);
    }
  }
}

export async function convexAs(page: Page) {
  const env = loadHrEnvironment();
  await clerk.loaded({ page });
  const token = await page.evaluate(async () =>
    window.Clerk.session?.getToken({ template: "convex" }),
  );
  if (!token) throw new Error("HR_E2E_REAL_CONVEX_JWT_REQUIRED");
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL, {
    logger: false,
  });
  client.setAuth(token);
  return {
    query: (name: string, args: Record<string, unknown> = {}) =>
      client.query(makeFunctionReference<"query">(name), args),
    mutation: (name: string, args: Record<string, unknown>) =>
      client.mutation(makeFunctionReference<"mutation">(name), args),
  };
}
