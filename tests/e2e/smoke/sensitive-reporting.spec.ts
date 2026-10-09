import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { summarizePlaywrightReport } from "../../../scripts/release/lib/smoke-report.mjs";

/** A real failing child suite proves Playwright does not add a raw reporter. */
test("sensitive failures retain only sanitized reports", async () => {
  const root = process.cwd();
  const owned = mkdtempSync(join(root, ".ci-report-privacy-"));
  const sentinel = "nonfunctional-private-browser-regression-sentinel";
  const outputFile = join(owned, "safe.json");
  const junitFile = join(owned, "safe.xml");
  const outputDir = join(owned, "results");
  try {
    const config = join(owned, "playwright.config.ts");
    writeFileSync(
      config,
      `import { defineConfig } from '@playwright/test';
import { runPolicy } from ${JSON.stringify(join(root, "tests/e2e/support/policy"))};
const policy = runPolicy({ sensitive: true, outputName: 'privacy-probe' });
export default defineConfig({
  ...policy, testDir: ${JSON.stringify(owned)}, testMatch: 'privacy.spec.ts',
  workers: 1, retries: 0, outputDir: ${JSON.stringify(outputDir)},
  reporter: [[${JSON.stringify(join(root, "tests/e2e/support/sensitive-reporter.ts"))},
    { outputFile: ${JSON.stringify(outputFile)}, junitFile: ${JSON.stringify(junitFile)} }]],
  use: { ...policy.use, browserName: 'chromium', baseURL: 'http://127.0.0.1:1' }
});
`,
    );
    writeFileSync(
      join(owned, "privacy.spec.ts"),
      `import { test, expect } from ${JSON.stringify(join(root, "tests/e2e/support/release-fixtures"))};
test('synthetic private failure', async ({ page }, info) => {
  await page.setContent(${JSON.stringify(`<h1>${sentinel}</h1>`)});
  console.log(${JSON.stringify(sentinel)});
  console.error(${JSON.stringify(sentinel)});
  await info.attach('synthetic private attachment', { body: Buffer.from(${JSON.stringify(sentinel)}) });
  expect(await page.locator('h1').innerText()).toBe('safe expected value');
});
test('uncaught page errors cannot hide behind successful assertions', async ({ page }) => {
  await page.setContent('<h1>synthetic page</h1>');
  const error = page.waitForEvent('pageerror');
  await page.evaluate((message) => { setTimeout(() => { throw new Error(message); }, 0); }, ${JSON.stringify(sentinel)});
  await error;
  expect(await page.locator('h1').innerText()).toBe('synthetic page');
});
`,
    );
    const result = spawnSync(
      "pnpm",
      ["exec", "playwright", "test", "--config", config],
      {
        cwd: root,
        env: {
          ...process.env,
          CI: "1",
          NODE_ENV: "test",
          SMOKE_TARGET: "production",
        },
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    expect(result.status).toBe(1);
    const json = readFileSync(outputFile, "utf8");
    expect(summarizePlaywrightReport(JSON.parse(json))).toMatchObject({
      ok: false,
      failed: 2,
      passed: 0,
    });
    const retained: string[] = [];
    const readArtifacts = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) readArtifacts(path);
        else retained.push(readFileSync(path, "utf8"));
        expect(entry.name).not.toMatch(/error-context|trace|screenshot|video/);
      }
    };
    readArtifacts(outputDir);
    const surfaces = [
      result.stdout,
      result.stderr,
      json,
      readFileSync(junitFile, "utf8"),
      ...retained,
    ].join("\n");
    expect(surfaces).not.toContain(sentinel);
    expect(surfaces).not.toContain(Buffer.from(sentinel).toString("base64"));
  } finally {
    rmSync(owned, { recursive: true, force: true });
  }
});
