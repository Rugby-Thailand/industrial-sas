// Numeric-only lab evidence. Run against an isolated production build and local fixtures.
import { chromium, expect } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  measurementOptions,
  evidenceLabel,
  summarize,
  observeTransition,
} from "./measurement.mjs";
const label = evidenceLabel(process.argv[2] ?? "baseline");
const options = measurementOptions();
if (options.scenarios.includes("legacy") && options.network !== "none")
  throw Error("Legacy measurements require unthrottled loopback");
process.loadEnvFile(process.env.PERFORMANCE_ENV_FILE ?? ".env.local");
const base =
  process.env.PERFORMANCE_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
if (
  ![base, process.env.NEXT_PUBLIC_CONVEX_URL].every((url) =>
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url ?? ""),
  ) ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
  process.env.ALLOW_LOCAL_TEST_SEED !== "true"
)
  throw Error("Isolated loopback/test identity required");
const fixture = JSON.parse(
  readFileSync(
    process.env.PERFORMANCE_FIXTURE_FILE ?? "output/local-test-data.json",
    "utf8",
  ),
);
const browser = await chromium.launch();
let revokeLogin;
try {
  const buildDir =
    process.env.PERFORMANCE_BUILD_DIR ?? process.env.NEXT_DIST_DIR ?? ".next";
  if (!/^(?:\.next|[a-zA-Z0-9])[a-zA-Z0-9._-]*$/.test(buildDir))
    throw Error("Invalid local build directory");
  const nextBuildId = readFileSync(`${buildDir}/BUILD_ID`, "utf8").trim();
  const git = (args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const source = {
    head: git(["rev-parse", "HEAD"]),
    dirty: git(["status", "--porcelain"]).length > 0,
    guardBlob: git([
      "hash-object",
      "src/components/navigation/NavigationGuardProvider.tsx",
    ]),
  };
  const login = await browser.newContext();
  const page = await login.newPage();
  const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const ticket = await client.signInTokens.createSignInToken({
    userId:
      process.env.LOCAL_TEST_CLERK_USER_ID ??
      "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
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
  const sessionId = await page.evaluate(() => window.Clerk.session.id);
  revokeLogin = () => client.sessions.revokeSession(sessionId);
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
  const queryRows = [];
  const rows = [];
  const record = (row) => {
    if (row.run >= 0) rows.push(row);
  };
  if (options.scenarios.includes("legacy")) {
    const jwt = await page.evaluate(() =>
      window.Clerk.session.getToken({ template: "convex" }),
    );
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
    convex.setAuth(jwt);

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
      for (let run = -options.warmups; run < options.samples; run++) {
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
          if (run >= 0)
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

    for (const viewport of options.widths.map((width) => ({
      width,
      height: width === 390 ? 844 : 900,
    }))) {
      for (const locale of options.locales) {
        for (let run = -options.warmups; run < options.samples; run++) {
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
            record({
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
          record({
            flow: "product-navigation",
            viewport: viewport.width,
            locale,
            run,
            usableMs: performance.now() - clickStarted,
          });
          const detailStarted = performance.now();
          await p.reload();
          await p.getByRole("textbox").first().waitFor();
          record({
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
          await p
            .locator("[data-map-zone-id]")
            .first()
            .waitFor({ timeout: 60000 });
          record({
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
  }
  await measureNavigation();
  mkdirSync("output/performance", { recursive: true });
  writeFileSync(
    `output/performance/${label}.json`,
    JSON.stringify(
      {
        revision: /^[a-f0-9]{7,40}$/.test(
          process.env.PERFORMANCE_REVISION ?? "",
        )
          ? process.env.PERFORMANCE_REVISION
          : undefined,
        browserVersion: browser.version(),
        nextBuildId,
        source,
        network:
          options.network === "none"
            ? "Unthrottled loopback; external Clerk test authentication"
            : "Chromium CDP HTTP latency150ms/down200000Bps/up93750Bps; does not establish Convex WebSocket message shaping",
        protocol: options,
        summary: summarize(rows),
        machine: {
          platform: process.platform,
          arch: process.arch,
          cpu: os.cpus()[0].model,
          node: process.version,
        },
        conditions:
          "Local production Next; Chromium; loopback; authenticated synthetic fixtures; cold=new browser context (OS/backend caches retained); warm=same-context revisit after warmup; URL observed is not React commit; nearest-rank descriptive p50/p95; lab only",
        rows,
        queryRows,
      },
      null,
      2,
    ),
  );
  console.log(`Saved ${rows.length} numeric lab samples`);

  async function measureNavigation() {
    for (const width of options.widths)
      for (const locale of options.locales) {
        const messages = JSON.parse(
          readFileSync(`messages/${locale}.json`, "utf8"),
        );
        const catalogue = `/${locale}/master-data/storage-layouts`;
        const floor = `${catalogue}/${fixture.buildingId}`;
        const goods = `/${locale}/finished-goods`,
          scan = `${goods}/scan`;
        const employees = `/${locale}/hr/employees`;
        const editPrefix = messages.Hr.employees.editLabel.split("{name}")[0];
        const ready = {
          catalogue: { kind: "catalogue", floor },
          floor: {
            kind: "floor",
            toolbar: messages.StorageLayouts.floorSelector,
          },
          goods: { kind: "goods" },
          scan: { kind: "scan", heading: messages.JobScan.locationStepTitle },
          hrList: { kind: "hr-list", editPrefix },
          hrEditor: { kind: "hr-editor" },
        };
        const flows = [];
        if (options.scenarios.includes("floor")) {
          if (!fixture.buildingId)
            throw Error("Seeded building fixture required");
          flows.push(
            {
              flow: "catalogue-to-floor",
              source: catalogue,
              target: floor,
              ready: ready.floor,
              sourceReady: ready.catalogue,
            },
            {
              flow: "floor-to-catalogue",
              source: floor,
              target: catalogue,
              ready: ready.catalogue,
              sourceReady: ready.floor,
            },
          );
        }
        if (options.scenarios.includes("scan"))
          flows.push(
            {
              flow: "goods-to-scan",
              source: goods,
              target: scan,
              ready: ready.scan,
              sourceReady: ready.goods,
            },
            {
              flow: "scan-to-goods",
              source: scan,
              target: goods,
              ready: ready.goods,
              sourceReady: ready.scan,
            },
          );
        if (options.scenarios.includes("hr")) {
          if (!fixture.hrProfile) throw Error("Seeded HR fixture required");
          flows.push(
            {
              flow: "hr-list-to-editor",
              source: employees,
              target: "hr-editor",
              ready: ready.hrEditor,
              sourceReady: ready.hrList,
              action: { kind: "hr-edit", name: editPrefix },
            },
            {
              flow: "hr-editor-to-list",
              source: employees,
              target: employees,
              ready: ready.hrList,
              sourceReady: ready.hrList,
              editorSource: true,
              action: { kind: "button", name: messages.App.back },
            },
          );
        }
        for (const flow of flows)
          for (const cache of ["cold", "warm"]) {
            let ctx, p;
            const create = async () => {
              ctx = await browser.newContext({
                storageState,
                viewport: { width, height: width === 390 ? 844 : 900 },
                serviceWorkers: "block",
              });
              p = await ctx.newPage();
              p.setDefaultTimeout(15000);
              p.setDefaultNavigationTimeout(15000);
              if (options.network === "latency150") {
                const cdp = await ctx.newCDPSession(p);
                await cdp.send("Network.enable");
                await cdp.send("Network.emulateNetworkConditions", {
                  offline: false,
                  latency: 150,
                  downloadThroughput: 200000,
                  uploadThroughput: 93750,
                });
              }
            };
            const source = async () => {
              if (cache === "warm" && p.url() !== "about:blank") {
                const current = new URL(p.url());
                if (current.pathname !== flow.source || current.search) {
                  const returning = await p.evaluate(observeTransition, {
                    target: flow.source,
                    ready: flow.sourceReady,
                    action:
                      current.search && flow.sourceReady.kind === "hr-list"
                        ? { kind: "button", name: messages.App.back }
                        : { kind: "link", href: flow.source },
                  });
                  if (returning.status !== "completed")
                    throw Error("Warm source navigation failed");
                }
              } else
                await p.goto(`${base}${flow.source}`, {
                  waitUntil: "domcontentloaded",
                });
              if (flow.sourceReady.kind === "catalogue")
                await p.locator(`a[href="${floor}"]`).first().waitFor();
              if (flow.sourceReady.kind === "floor") {
                await p
                  .getByRole("button", {
                    name: messages.StorageLayouts.floorSelector,
                    exact: true,
                  })
                  .waitFor();
                await p.locator("[data-map-zone-id]").first().waitFor();
              }
              if (flow.sourceReady.kind === "goods")
                await p
                  .locator('a[href*="/finished-goods/products/"]')
                  .first()
                  .waitFor();
              if (flow.sourceReady.kind === "scan") {
                await p
                  .getByRole("heading", {
                    name: messages.JobScan.locationStepTitle,
                    exact: true,
                  })
                  .waitFor();
                await p
                  .getByRole("button", { name: /DEMO-ANNEX-/ })
                  .first()
                  .waitFor();
              }
              if (flow.sourceReady.kind === "hr-list")
                await p
                  .locator(`button[aria-label^="${editPrefix}"]`)
                  .first()
                  .waitFor();
              if (flow.editorSource) {
                await p
                  .locator(`button[aria-label^="${editPrefix}"]`)
                  .first()
                  .click();
                await p
                  .getByTestId("hr-employee-form")
                  .locator('input[id$="-name"]')
                  .waitFor();
              }
            };
            let completed = 0,
              attempts = 0,
              errors = 0;
            try {
              await create();
              // Warmup samples are excluded; cold measured samples each use a fresh context.
              for (
                let run = -options.warmups;
                completed < options.samples && attempts < options.samples + 10;
                run++
              ) {
                if (cache === "cold" && run >= 0) {
                  await ctx.close();
                  await create();
                }
                let sample;
                let pageError = false;
                const onError = () => {
                  pageError = true;
                };
                p.on("pageerror", onError);
                try {
                  await source();
                  sample = await p.evaluate(observeTransition, {
                    target: flow.target,
                    ready: flow.ready,
                    action: flow.action ?? { kind: "link", href: flow.target },
                  });
                } catch {
                  sample = {
                    status: p.isClosed() ? "cancelled" : "error",
                    reason: p.isClosed()
                      ? "page-closed"
                      : "setup-or-evaluation",
                  };
                } finally {
                  p.off("pageerror", onError);
                }
                if (pageError)
                  sample = { ...sample, status: "error", reason: "page-error" };
                if (run < 0) {
                  if (sample.status !== "completed") {
                    rows.push({
                      flow: flow.flow,
                      width,
                      locale,
                      cache,
                      run,
                      warmup: true,
                      ...sample,
                    });
                    errors++;
                    break;
                  }
                  continue;
                }
                attempts++;
                rows.push({
                  flow: flow.flow,
                  width,
                  locale,
                  cache,
                  run: attempts - 1,
                  ...sample,
                });
                if (sample.status === "completed") completed++;
                if (sample.status === "error" && ++errors >= 3) break;
              }
            } finally {
              await ctx?.close();
            }
            console.log(
              JSON.stringify({
                flow: flow.flow,
                width,
                locale,
                cache,
                completed,
                errors,
                attempts,
              }),
            );
            if (completed < options.samples) process.exitCode = 1;
          }
      }
  }
} catch {
  console.error("Local measurement failed; sensitive diagnostics withheld");
  process.exitCode = 1;
} finally {
  await browser.close();
  await revokeLogin?.().catch(() => {
    console.error(
      "Test session cleanup failed; sensitive diagnostics withheld",
    );
    process.exitCode = 1;
  });
}
