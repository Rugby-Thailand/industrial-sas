import { appendFileSync, mkdirSync } from "node:fs";
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
    const authEvents: object[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        url.hostname === "localhost" &&
        response.request().isNavigationRequest()
      )
        authEvents.push({
          event: "document-response",
          at: Date.now(),
          path: url.pathname,
          status: response.status(),
        });
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        const url = new URL(frame.url());
        authEvents.push({
          event: "navigation",
          at: Date.now(),
          path: url.pathname,
        });
      }
    });
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
      await authCheckpoint(page, "fixture-ready");
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
        await authCheckpoint(page, "fixture-final", ownedSession);
        mkdirSync(".cache/hr-browser", { recursive: true, mode: 0o700 });
        appendFileSync(
          ".cache/hr-browser/session-navigation.jsonl",
          JSON.stringify({
            test: info.title,
            project: info.project.name,
            status: info.status,
            events: authEvents,
          }) + "\n",
          { mode: 0o600 },
        );
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

/** Private metadata only: no cookies, JWTs, request URLs or unrelated sessions. */
export async function authCheckpoint(
  page: Page,
  stage: string,
  ownedId?: string,
) {
  const browser = await page
    .evaluate(() => ({
      path: location.pathname,
      sessionId: window.Clerk?.session?.id ?? null,
      userId: window.Clerk?.user?.id ?? null,
      organizationId: window.Clerk?.organization?.id ?? null,
      status: window.Clerk?.session?.status ?? null,
    }))
    .catch(() => null);
  const cookies = await page.context().cookies("http://localhost:3110");
  const cookieMetadata = cookies
    .filter(
      (cookie) =>
        cookie.name.startsWith("__session") ||
        cookie.name.startsWith("__client"),
    )
    .map((cookie) => ({
      name: cookie.name,
      present: cookie.value.length > 0,
      expires: cookie.expires,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
    }));
  const id = ownedId ?? browser?.sessionId;
  let server: object | null = null;
  if (id) {
    try {
      const session = await createClerkClient({
        secretKey: loadHrEnvironment().CLERK_SECRET_KEY,
      }).sessions.getSession(id);
      server = {
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastActiveAt: session.lastActiveAt,
      };
    } catch {
      server = { unavailable: true };
    }
  }
  mkdirSync(".cache/hr-browser", { recursive: true, mode: 0o700 });
  appendFileSync(
    ".cache/hr-browser/session-checkpoints.jsonl",
    JSON.stringify({ stage, at: Date.now(), browser, cookieMetadata, server }) +
      "\n",
    { mode: 0o600 },
  );
}
