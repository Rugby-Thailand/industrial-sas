import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const git = (...args: readonly string[]): string =>
  execFileSync("git", [...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

describe("next-env.d.ts is generated, not tracked", () => {
  it("is ignored by git", () => {
    const rule = git(
      "check-ignore",
      "--verbose",
      "--no-index",
      "next-env.d.ts",
    );
    expect(rule).toContain(".gitignore");
    expect(rule).toContain("next-env.d.ts");
  });

  it("is not referenced as a required input by the type checker", () => {
    const tsconfig = readFileSync(join(ROOT, "tsconfig.json"), "utf8");
    expect(tsconfig).toContain('".next/types/**/*.ts"');
    expect(tsconfig).toContain('".next/dev/types/**/*.ts"');
  });

  it("records why, next to the rule", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    const index = ignore.indexOf("/next-env.d.ts");
    expect(index).toBeGreaterThan(-1);
    const preamble = ignore.slice(Math.max(0, index - 900), index);
    expect(preamble).toContain("next dev");
    expect(preamble).toContain("next build");
  });
});

describe("the end-to-end runner tolerates a missing next-env.d.ts", () => {
  it("reads it conditionally rather than at import time", () => {
    const runner = readFileSync(join(ROOT, "scripts", "run-e2e.mjs"), "utf8");
    expect(runner).toMatch(/existsSync\(nextEnvPath\)[\s\S]*readFileSync/);
    expect(runner).toContain("if (nextEnv !== undefined)");
  });
});
