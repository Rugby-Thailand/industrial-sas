/**
 * Integration tier — generated files stay generated, and tracked files stay
 * unmodified by a build.
 *
 * ### The defect this exists for
 *
 * `next-env.d.ts` is written by Next, and on Next 16 its contents depend on
 * which command wrote it: `next dev` emits
 * `import "./.next/dev/types/routes.d.ts"` and `next build` emits
 * `import "./.next/types/routes.d.ts"`. It used to be tracked, with the `dev`
 * variant committed — so the `build` CI job, whose last step asserted the tree
 * was clean after `next build`, could not pass, and every developer who ran
 * `pnpm build` got a modified file they had not touched.
 *
 * Committing the other variant would only move the failure to whoever ran
 * `pnpm dev`. A file whose correct contents depend on which command ran last has
 * no correct committed value, so it is not committed.
 *
 * ### Why that is safe
 *
 * Nothing reads it that is not already covered. `tsconfig.json` includes
 * `.next/types/**` and `.next/dev/types/**` in its own right, so the route types
 * arrive without this file pointing at them; and `pnpm typecheck` passes on a
 * cold tree with no `.next` directory *and* no `next-env.d.ts`, which is exactly
 * the state of the `static-analysis` CI job. That was measured, not assumed —
 * and the assertions below are what stop it drifting back.
 */
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
    /*
     * `git check-ignore` matches the path against the ignore rules regardless of
     * whether the file currently exists or is still in the index, so this is
     * stable both before and after the removal commit lands.
     */
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
    /*
     * `tsconfig.json` may still *list* it — Next re-adds it to `include` and
     * fighting that is not worth it — but the route types it points at have to be
     * reachable without it. Both globs are what make the file redundant.
     */
    const tsconfig = readFileSync(join(ROOT, "tsconfig.json"), "utf8");
    expect(tsconfig).toContain('".next/types/**/*.ts"');
    expect(tsconfig).toContain('".next/dev/types/**/*.ts"');
  });

  it("records why, next to the rule", () => {
    // The rule without the reason is a rule the next person deletes.
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
    /*
     * `scripts/run-e2e.mjs` snapshots the file so the production build and the
     * development server do not fight over its contents mid-run. That snapshot
     * used to be an unconditional top-level `readFileSync`, which now throws on
     * a clean checkout — before a single test runs, and with a stack trace that
     * names neither the suite nor the cause.
     */
    const runner = readFileSync(join(ROOT, "scripts", "run-e2e.mjs"), "utf8");
    expect(runner).toMatch(/existsSync\(nextEnvPath\)[\s\S]*readFileSync/);
    expect(runner).toContain("if (nextEnv !== undefined)");
  });
});
