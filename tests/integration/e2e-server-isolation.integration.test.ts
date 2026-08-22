import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import config, { APP_DIST } from "../../playwright.config";

const runnerPath = join(process.cwd(), "scripts", "run-e2e.mjs");

describe("the end-to-end server", () => {
  const servers = Array.isArray(config.webServer)
    ? config.webServer
    : config.webServer === undefined
      ? []
      : [config.webServer];

  it("serves one isolated production build", () => {
    expect(servers).toHaveLength(1);
    expect(servers[0]?.command).toContain("next start");
    expect(servers[0]?.command).not.toContain("next dev");
    expect(servers[0]?.env?.["NEXT_DIST_DIR"]).toBe(APP_DIST);
    expect(servers[0]?.reuseExistingServer).toBe(false);
  });

  it("builds before Playwright and touches no developer build", () => {
    const runner = readFileSync(runnerPath, "utf8");
    expect(runner.indexOf('"build"')).toBeLessThan(
      runner.indexOf('"playwright"'),
    );
    expect(runner).toContain(`const appDist = "${APP_DIST}"`);
    expect(runner).not.toContain('".next"');
    expect(runner).not.toContain('".next-preview"');
  });

  it("uses no public data bypass", () => {
    const source = `${JSON.stringify(config)}\n${readFileSync(runnerPath, "utf8")}`;
    expect(source).not.toContain("LOCAL_PREVIEW");
    expect(source).not.toContain("preview-chromium");
  });
});
