import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();

describe("root lint inputs", () => {
  it("ignores local scratch files, nested checkouts and archived review probes", async () => {
    for (const path of [
      ".claude/worktrees/agent-fixture/src/app/page.tsx",
      ".claude-worktrees/fixture/convex/_generated/api.js",
      "tmp/bug-audit/fixture.ts",
      "temp/fixture.ts",
      "docs/reviews/fixture/probes/kiro/src/probe.tsx",
      "docs/reviews/fixture/kiro-limits.probe.ts",
    ]) {
      expect(await eslint.isPathIgnored(path), path).toBe(true);
    }
  });

  it("still reports violations in maintained source, tests, scripts and documentation tools", async () => {
    for (const filePath of [
      "src/lib/lint-input-fixture.ts",
      "convex/lib/lint-input-fixture.ts",
      "tests/integration/lint-input-fixture.test.ts",
      "scripts/ci/lint-input-fixture.mjs",
      "docs/reviews/fixture/capture.mjs",
    ]) {
      expect(await eslint.isPathIgnored(filePath), filePath).toBe(false);
      const typescript = filePath.endsWith(".ts");
      const [result] = await eslint.lintText(
        typescript ? "const unusedProbe = 1;\n" : "const = ;\n",
        { filePath },
      );
      expect(result?.errorCount, filePath).toBeGreaterThan(0);
      if (typescript)
        expect(
          result?.messages.map(({ ruleId }) => ruleId),
          filePath,
        ).toContain("@typescript-eslint/no-unused-vars");
      else expect(result?.fatalErrorCount, filePath).toBe(1);
    }
  });
});
