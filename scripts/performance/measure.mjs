// Numeric-only lab evidence. Run against an isolated production build and local fixtures.
import { chromium } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const label = process.argv[2] ?? "baseline";
process.loadEnvFile(".env.local");
const base =
  process.env.PERFORMANCE_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
if (
  ![base, process.env.NEXT_PUBLIC_CONVEX_URL].every((url) =>
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url ?? ""),
  ) ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")
)
  throw Error("Isolated loopback/test identity required");
const fixture = JSON.parse(readFileSync("output/local-test-data.json", "utf8"));
const browser = await chromium.launch();
const login = await browser.newContext();
const page = await login.newPage();
const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const ticket = await client.signInTokens.createSignInToken({
  userId:
    process.env.LOCAL_TEST_CLERK_USER_ID ?? "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
  orgId:
    process.env.LOCAL_TEST_CLERK_ORG_ID ?? "org_3JXrDUraQjTRO3hcIzMGC9CvIXV",
  expiresInSeconds: 300,
});
const url = new URL("/en/sign-in", base);
url.searchParams.set("__clerk_ticket", ticket.token);
url.searchParams.set("__clerk_status", "sign_in");
url.searchParams.set("redirect_url", "/en/finished-goods");
await page.goto(url.href);
await page.waitForURL("**/en/finished-goods", { timeout: 60000 });
await page
  .getByRole("heading", { name: "Finished goods", exact: true })
  .waitFor({ timeout: 60000 });
await page.waitForFunction(() => window.Clerk?.session);
const storageState = await login.storageState();
const init = () => {
  window.__labLongTasks = [];
  new PerformanceObserver((l) =>
    window.__labLongTasks.push(...l.getEntries().map((e) => e.duration)),
  ).observe({ type: "longtask", buffered: true });
};
const metrics = async (p) => {
  await p.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  return p.evaluate(() => ({
    navigationMs: performance.getEntriesByType("navigation")[0]?.duration,
    jsDecodedBytes: performance
      .getEntriesByType("resource")
      .filter((r) => r.initiatorType === "script" || r.name.endsWith(".js"))
      .reduce((s, r) => s + r.decodedBodySize, 0),
    jsTransferBytes: performance
      .getEntriesByType("resource")
      .filter((r) => r.initiatorType === "script" || r.name.endsWith(".js"))
      .reduce((s, r) => s + r.transferSize, 0),
    longTaskCount: window.__labLongTasks.length,
    longTaskMs: window.__labLongTasks.reduce((s, d) => s + d, 0),
  }));
};
const rows = [];
const jwt = await page.evaluate(() =>
  window.Clerk.session.getToken({ template: "convex" }),
);
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
convex.setAuth(jwt);
const queryRows = [];
const filters = {
  record: "",
  unit: "",
  quantity: { min: "", max: "" },
  formats: [],
  progress: [],
  statuses: [],
  lot: "",
  measurement: "",
  length: { min: "", max: "" },
  width: { min: "", max: "" },
  height: { min: "", max: "" },
  sort: "",
};
for (const search of ["", "PAGINATION-0120"]) {
  for (let run = 0; run < 3; run++) {
    let scanCursor;
    for (let step = 0; step < 200; step++) {
      const started = performance.now();
      const result = await convex.query(
        makeFunctionReference("finishedGoods/catalogue:page"),
        {
          warehouseId: fixture.warehouseId,
          tab: "products",
          search,
          filters,
          locale: "en",
          pageSize: 20,
          ...(scanCursor ? { scanCursor } : {}),
        },
      );
      queryRows.push({
        search: search ? "sparse" : "blank",
        run,
        step,
        queryMs: performance.now() - started,
        responseBytes: Buffer.byteLength(JSON.stringify(result)),
      });
      if (!result.ok || result.value.status !== "scanning") break;
      scanCursor = result.value.scanCursor;
    }
  }
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const locale of ["en", "th"]) {
    for (let run = 0; run < 3; run++) {
      const ctx = await browser.newContext({ storageState, viewport });
      await ctx.addInitScript(init);
      const p = await ctx.newPage();
      for (const cache of ["cold", "warm"]) {
        const started = performance.now();
        await p.goto(`${base}/${locale}/finished-goods`);
        await p
          .locator('a[href*="/finished-goods/products/"]')
          .first()
          .waitFor({ timeout: 60000 });
        rows.push({
          flow: "catalogue",
          viewport: viewport.width,
          locale,
          run,
          cache,
          usableMs: performance.now() - started,
          ...(await metrics(p)),
        });
      }
      const productLink = p
        .locator('a[href*="/finished-goods/products/"]')
        .first();
      const clickStarted = performance.now();
      await productLink.click();
      await p.getByRole("textbox").first().waitFor();
      rows.push({
        flow: "product-navigation",
        viewport: viewport.width,
        locale,
        run,
        usableMs: performance.now() - clickStarted,
      });
      const detailStarted = performance.now();
      await p.reload();
      await p.getByRole("textbox").first().waitFor();
      rows.push({
        flow: "product-detail",
        viewport: viewport.width,
        locale,
        run,
        cache: "route-warm",
        usableMs: performance.now() - detailStarted,
        ...(await metrics(p)),
      });
      const started = performance.now();
      await p.goto(
        `${base}/${locale}/master-data/storage-layouts/${fixture.storageUiProfile.referenceBuildingId}`,
      );
      await p.locator("[data-map-zone-id]").first().waitFor({ timeout: 60000 });
      rows.push({
        flow: "storage",
        viewport: viewport.width,
        locale,
        run,
        cache: "cold",
        usableMs: performance.now() - started,
        ...(await metrics(p)),
      });
      await ctx.close();
    }
  }
}
await browser.close();
mkdirSync("output/performance", { recursive: true });
writeFileSync(
  `output/performance/${label}.json`,
  JSON.stringify(
    {
      revision: process.env.PERFORMANCE_REVISION,
      machine: {
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0].model,
        node: process.version,
      },
      conditions:
        "Chromium; loopback; no throttling; authenticated synthetic fixtures; 3 samples; cold = new browser context, warm = same-context reload; lab only",
      rows,
      queryRows,
    },
    null,
    2,
  ),
);
console.log(`Saved ${rows.length} numeric lab samples`);
