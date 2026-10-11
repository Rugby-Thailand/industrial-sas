// Authenticated behavior verification, restricted to an isolated local backend.
import { chromium, expect } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
process.loadEnvFile(".env.local");
const base =
  process.env.PERFORMANCE_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
const backend = process.env.NEXT_PUBLIC_CONVEX_URL;
for (const url of [base, backend])
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url ?? ""))
    throw Error("Isolated loopback required");
if (
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
  process.env.ALLOW_LOCAL_TEST_SEED !== "true"
)
  throw Error("Local synthetic test identity required");
const fixture = JSON.parse(readFileSync("output/local-test-data.json", "utf8"));
const browser = await chromium.launch();
const login = await browser.newContext();
const page = await login.newPage();
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const ticket = await clerk.signInTokens.createSignInToken({
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
await page.locator('a[href*="/finished-goods/products/"]').first().waitFor();
const storageState = await login.storageState();
const jwt = await page.evaluate(() =>
  window.Clerk.session.getToken({ template: "convex" }),
);
const http = new ConvexHttpClient(backend);
http.setAuth(jwt);
const ref = (name) => makeFunctionReference(`finishedGoods/workflow:${name}`);
const save = ref("saveProduct");
const get = ref("getProduct");
const results = [];
const demo = await http.query(
  makeFunctionReference("finishedGoods/catalogue:findSku"),
  {
    warehouseId: fixture.warehouseId,
    sku: "DEMO-SNACK",
  },
);
expect(demo.ok && Boolean(demo.value)).toBe(true);
await page.goto(`${base}/en/finished-goods/products/${demo.value._id}`);
const opener = page.getByRole("button", { name: /^View storage / }).first();
await opener.waitFor();
await page.waitForLoadState("networkidle");
const scriptBytes = () =>
  page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((r) => r.initiatorType === "script" || r.name.endsWith(".js"))
      .reduce((s, r) => s + r.decodedBodySize, 0),
  );
const beforeEditorBytes = await scriptBytes();
const editorStarted = performance.now();
await opener.click();
const dialog = page.getByRole("dialog", { name: "Batch details" });
await dialog.getByText(/DEMO-R26-CREATED/).waitFor();
await dialog
  .getByRole("button", { name: "Edit available units", exact: true })
  .click();
await dialog.locator("input").first().waitFor();
const editorUsableMs = performance.now() - editorStarted;
expect(
  await dialog.evaluate((node) => node.contains(document.activeElement)),
).toBe(true);
const deferredJsBytes = (await scriptBytes()) - beforeEditorBytes;
expect(deferredJsBytes).toBeGreaterThan(0);
await page.keyboard.press("Escape");
await expect(dialog).not.toBeVisible();
await expect(opener).toBeFocused();
results.push({
  flow: "lazy-batch-editor-focus",
  passed: true,
  deferredJsBytes,
  editorUsableMs,
});
const seed = {
  warehouseId: fixture.warehouseId,
  sku: `PERF-${randomUUID()}`,
  name: "Performance synthetic fixture",
  unit: "unit",
  storageCondition: "ANY",
  draft: false,
  requestId: randomUUID(),
};
const created = await http.mutation(save, seed);
expect(created.ok && created.value.written).toBe(true);
const productId = created.value.documentId;
const productArgs = { warehouseId: fixture.warehouseId, productId };
// Compile the actual pure updater and its real reference adapter for Node.
// No copied implementation or alternate mutation logic is used.
const temp = resolve(".cache/performance");
mkdirSync(temp, { recursive: true });
const emit = (source, name, replacements = []) => {
  let code = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  for (const [from, to] of replacements) code = code.replace(from, to);
  writeFileSync(resolve(temp, name), code);
};
emit("src/lib/convex/clientRef.ts", "clientRef.mjs");
emit("src/lib/convex/finishedGoodsApi.ts", "finishedGoodsApi.mjs", [
  [
    "../../../convex/_generated/api",
    pathToFileURL(resolve("convex/_generated/api.js")).href,
  ],
  ["./clientRef", "./clientRef.mjs"],
]);
emit(
  "src/features/finishedGoods/optimisticProductDetails.ts",
  "optimisticProductDetails.mjs",
  [["@/lib/convex/finishedGoodsApi", "./finishedGoodsApi.mjs"]],
);
const { optimisticProductDetails } = await import(
  pathToFileURL(resolve(temp, "optimisticProductDetails.mjs")).href
);
const live = new ConvexClient(backend);
live.setAuth(async () => jwt);
const changes = [];
const subscription = live.onUpdate(get, productArgs, (value) =>
  changes.push(value),
);
await expect.poll(() => changes.length).toBeGreaterThan(0);
const update = {
  ...seed,
  ...productArgs,
  sku: subscription.getCurrentValue().value.sku,
  requestId: randomUUID(),
  name: "  Confirmed synthetic description  ",
};
const pending = live.mutation(save, update, {
  optimisticUpdate: optimisticProductDetails,
});
expect(subscription.getCurrentValue().value.name).toBe(update.name);
const confirmed = await pending;
expect(confirmed.ok && confirmed.value.written).toBe(true);
await expect
  .poll(() => subscription.getCurrentValue().value.name)
  .toBe(update.name.trim());
const invalid = live.mutation(
  save,
  { ...update, requestId: randomUUID(), name: "   " },
  { optimisticUpdate: optimisticProductDetails },
);
expect(subscription.getCurrentValue().value.name).toBe("   ");
const rejected = await invalid;
expect(rejected.ok && rejected.value.written === false).toBe(true);
await expect
  .poll(() => subscription.getCurrentValue().value.name)
  .toBe(update.name.trim());
results.push({ flow: "optimistic-confirmation-and-rejection", passed: true });
subscription();
await live.close();
for (const width of [1440, 390])
  for (const locale of ["en", "th"]) {
    const ctx = await browser.newContext({
      storageState,
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const p = await ctx.newPage();
    const copy = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      .FinishedGoods.copy;
    const errors = [];
    p.on("pageerror", () => errors.push("pageerror"));
    await p.goto(`${base}/${locale}/finished-goods`);
    const search = p.getByRole("textbox", {
      name: copy["search-finished-goods"],
    });
    await search.fill("PAGINATION-0120");
    await expect(
      p.getByText("PAGINATION-0120", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    await search.fill("");
    await p
      .getByRole("button", {
        name: locale === "en" ? "Next page" : "หน้าถัดไป",
        exact: true,
      })
      .click();
    await expect(
      p
        .getByRole("status")
        .filter({ hasText: locale === "en" ? "Page 2" : "หน้า 2" }),
    ).toBeVisible();
    if (width === 1440) {
      await p
        .getByRole("button", {
          name: `${copy["filter-and-sort"]} ${locale === "en" ? "Product" : "สินค้า"}`,
          exact: true,
        })
        .click();
      await p.getByRole("combobox", { name: copy["sort-by"] }).click();
      await p
        .getByRole("option", {
          name: `${locale === "en" ? "SKU" : "รหัสสินค้า"} · ${copy.descending}`,
          exact: true,
        })
        .click();
      await p.getByRole("button", { name: copy.apply, exact: true }).click();
      await expect(
        p
          .getByRole("columnheader")
          .filter({ hasText: locale === "en" ? "Product" : "สินค้า" })
          .first(),
      ).toHaveAttribute("aria-sort", "descending");
      await expect(
        p
          .getByRole("status")
          .filter({ hasText: locale === "en" ? "Page 1" : "หน้า 1" }),
      ).toBeVisible();
    }
    await p.goto(`${base}/${locale}/finished-goods/products/${productId}`);
    const name = p.getByRole("textbox", {
      name: copy["product-name"],
      exact: true,
    });
    await expect(name).toHaveValue(update.name.trim());
    await name.fill(`Synthetic draft ${locale} ${width}`);
    p.once("dialog", (dialog) => dialog.accept());
    await p.reload();
    await expect(name).toHaveValue(`Synthetic draft ${locale} ${width}`);
    await p.getByRole("button", { name: copy.cancel, exact: true }).click();
    await expect(
      p.getByRole("dialog", { name: copy["discard-unsaved-changes"] }),
    ).toBeVisible();
    await p
      .getByRole("button", { name: copy["continue-editing"], exact: true })
      .click();
    await expect(name).toHaveValue(`Synthetic draft ${locale} ${width}`);
    await name.fill(update.name.trim());
    const note = p.getByRole("textbox", {
      name: copy["storage-notes"],
      exact: true,
    });
    await note.fill(`Synthetic description ${locale} ${width}`);
    await p
      .getByRole("button", { name: copy["save-product-details"], exact: true })
      .click();
    await p.waitForURL(`**/${locale}/finished-goods`);
    const authoritative = await http.query(get, productArgs);
    expect(authoritative.value.notes).toBe(
      `Synthetic description ${locale} ${width}`,
    );
    expect(authoritative.value.status).toBe("ACTIVE");
    await p.locator('a[href*="/finished-goods/products/"]').first().waitFor();
    mkdirSync("output/performance", { recursive: true });
    await p.screenshot({
      path: `output/performance/catalogue-${locale}-${width}.png`,
      fullPage: true,
    });
    expect(
      await p.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBe(0);
    expect(errors).toEqual([]);
    results.push({
      flow: "catalogue-complete-results-pagination-sort-form-draft-confirmation",
      width,
      locale,
      passed: true,
    });
    await ctx.close();
  }
await browser.close();
writeFileSync(
  "output/performance/authenticated-verification.json",
  JSON.stringify(
    {
      results,
      conditions:
        "Test Clerk identity; loopback backend; new synthetic product only; no production writes",
    },
    null,
    2,
  ),
);
console.log(`Passed ${results.length} authenticated local behavior flows`);
