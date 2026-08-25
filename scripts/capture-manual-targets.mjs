import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { MANUAL_TASKS } from "./manual/tasks.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const VIEWPORT = { width: 1280, height: 900 };

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/** @param {string} name */
const flag = (name) => {
  const found = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(`--${name}=`));
  return found === undefined ? undefined : found.slice(name.length + 3);
};

const baseUrl = flag("base-url") ?? process.env.MANUAL_CAPTURE_BASE_URL;
if (baseUrl === undefined || baseUrl === "") {
  fail(
    "No base URL. Set MANUAL_CAPTURE_BASE_URL or pass --base-url=http://localhost:3000.\n" +
      "This script needs a running, signed-in application; the offline manual build does not.",
  );
}

const locale = flag("locale") ?? "th";
const storageStateArgument =
  flag("storage-state") ?? process.env.MANUAL_CAPTURE_STORAGE_STATE;
const storageState =
  storageStateArgument === undefined
    ? undefined
    : resolve(repoRoot, storageStateArgument);
if (storageState !== undefined && !existsSync(storageState)) {
  fail(`Playwright storage-state file not found: ${storageState}`);
}
const outFile = resolve(
  repoRoot,
  flag("out") ?? `docs/manuals/assets/operator-guide-th/capture-${locale}.json`,
);

/** @type {{ chromium: import("playwright-core").BrowserType }} */
let playwright;
try {
  playwright = await import("playwright-core");
} catch {
  try {
    playwright = await import("@playwright/test");
  } catch {
    fail(
      "Playwright is not available in this environment.\n" +
        "Install it with `pnpm exec playwright install --with-deps` and run again.",
    );
  }
}

const browser = await playwright.chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  locale,
  ...(storageState === undefined ? {} : { storageState }),
});
const page = await context.newPage();

/** @type {Record<string, unknown>} */
const captured = {};
/** @type {string[]} */
const failures = [];

for (const task of MANUAL_TASKS) {
  if (task.route.includes("{")) {
    failures.push(
      `${task.id}: route ${task.route} needs a document id; capture it by hand`,
    );
    continue;
  }
  const url = `${baseUrl.replace(/\/$/, "")}/${locale}${task.route}`;
  try {
    const response = await page.goto(url, { waitUntil: "networkidle" });
    const status = response?.status() ?? 0;
    if (status >= 400) {
      failures.push(`${task.id}: ${url} answered HTTP ${status}`);
      continue;
    }
    if (new URL(page.url()).pathname.includes("/sign-in")) {
      failures.push(`${task.id}: ${url} redirected to sign-in; sign in first`);
      continue;
    }
    const targets = await page.$$eval("[data-manual-id]", (nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          manualId: node.getAttribute("data-manual-id"),
          x: Math.round(box.x),
          y: Math.round(box.y + window.scrollY),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      }),
    );
    if (targets.length === 0) {
      failures.push(`${task.id}: no [data-manual-id] element on ${url}`);
    }
    captured[task.id] = { route: task.route, targets };
  } catch (error) {
    failures.push(
      `${task.id}: ${url} could not be visited — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

await context.close();
await browser.close();

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(captured, null, 2)}\n`, "utf8");
process.stdout.write(
  `Wrote ${Object.keys(captured).length} captured route(s) to ${outFile.slice(repoRoot.length)}.\n`,
);

if (failures.length > 0) {
  process.stderr.write(
    `${failures.length} route(s) produced no usable measurement:\n` +
      `${failures.map((line) => `  ${line}`).join("\n")}\n` +
      `Until controls carry data-manual-id, this is expected; see ${join(
        "docs",
        "manuals",
        "operator-manual-authoring.md",
      )}.\n`,
  );
  process.exit(1);
}
