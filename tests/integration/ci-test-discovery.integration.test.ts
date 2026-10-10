import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { testDiscoveryProblems } from "../../scripts/ci/lib.mjs";

const fixtures: string[] = [];
const SCRIPT = join(process.cwd(), "scripts/ci/check-test-discovery.mjs");
const CONFIGS = [
  "playwright.config.ts",
  "playwright.workspace.config.ts",
  "playwright.staging.config.ts",
  "playwright.production.config.ts",
];

interface Inventory {
  tracked: string[];
  vitest: { file: string; projectName: string }[];
  playwright: Record<string, string[]>;
}

// Both executables return fixture inventories. Tests exercise the actual guard
// without invoking installed runners, a browser, git state or any network.
const FAKE_COMMAND = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const data = JSON.parse(fs.readFileSync("inventory.json", "utf8"));
const args = process.argv.slice(2);
if (path.basename(process.argv[1]) === "git") {
  process.stdout.write(data.tracked.join("\\0") + "\\0");
} else if (args[1] === "vitest") {
  process.stdout.write(JSON.stringify(data.vitest));
} else {
  const config = args[args.indexOf("--config") + 1];
  const files = data.playwright[config] || [];
  process.stdout.write(JSON.stringify({
    config: { rootDir: process.cwd() },
    suites: [{ suites: files.map(file => ({ file, specs: [{ title: "collected" }] })) }],
  }));
}
`;

function runInventory(inventory: Inventory) {
  // macOS's /var temp directory is an alias of /private/var; match the physical
  // cwd spelling returned by the child process when reporting absolute paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ci-discovery-test-")));
  fixtures.push(root);
  mkdirSync(join(root, "scripts/ci"), { recursive: true });
  mkdirSync(join(root, "bin"));
  cpSync(SCRIPT, join(root, "scripts/ci/check-test-discovery.mjs"));
  cpSync(join(dirname(SCRIPT), "lib.mjs"), join(root, "scripts/ci/lib.mjs"));
  for (const command of ["git", "pnpm"])
    writeFileSync(join(root, "bin", command), FAKE_COMMAND, { mode: 0o755 });
  writeFileSync(
    join(root, "inventory.json"),
    JSON.stringify({
      ...inventory,
      vitest: inventory.vitest.map(({ file, projectName }) => ({
        file: file.startsWith("absolute:")
          ? join(root, file.slice("absolute:".length))
          : file,
        projectName,
      })),
      playwright: Object.fromEntries(
        Object.entries(inventory.playwright).map(([config, files]) => [
          config,
          files.map((file) =>
            file.startsWith("absolute:")
              ? join(root, file.slice("absolute:".length))
              : file,
          ),
        ]),
      ),
    }),
  );
  return spawnSync(process.execPath, ["scripts/ci/check-test-discovery.mjs"], {
    cwd: root,
    env: {
      NODE_ENV: "test",
      PATH: `${join(root, "bin")}:${dirname(process.execPath)}`,
    },
    encoding: "utf8",
    timeout: 10_000,
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("complete tracked test discovery", () => {
  it.each([
    "js",
    "jsx",
    "ts",
    "tsx",
    "cjs",
    "cjsx",
    "cts",
    "ctsx",
    "mjs",
    "mjsx",
    "mts",
    "mtsx",
  ])(
    "requires Vitest-supported test and spec files with extension %s",
    (extension) => {
      const tracked = [
        `src/outside-current-globs/a.test.${extension}`,
        `tests/b.spec.${extension}`,
      ];
      expect(
        testDiscoveryProblems({ tracked, vitest: [], playwright: [] }),
      ).toEqual(
        tracked.map((file) => `${file}: not collected by any runner`).sort(),
      );
    },
  );

  it("accepts the union of runner projects while deduplicating browser matrices", () => {
    expect(
      testDiscoveryProblems({
        tracked: [
          "src/a.test.tsx",
          "tests/b.test.cts",
          "browser/c.spec.mjs",
          "README.md",
        ],
        vitest: [
          { file: "src/a.test.tsx", projectName: "unit" },
          { file: "tests/b.test.cts", projectName: "integration" },
        ],
        playwright: ["browser/c.spec.mjs", "browser/c.spec.mjs"],
      }),
    ).toEqual([]);
  });

  it("rejects duplicate Vitest ownership and cross-runner overlap", () => {
    expect(
      testDiscoveryProblems({
        tracked: ["a.test.ts", "b.spec.ts"],
        vitest: [
          { file: "a.test.ts", projectName: "unit" },
          { file: "a.test.ts", projectName: "integration" },
          { file: "b.spec.ts", projectName: "unit" },
        ],
        playwright: ["b.spec.ts"],
      }),
    ).toEqual([
      "a.test.ts: collected more than once (vitest:unit, vitest:integration)",
      "b.spec.ts: collected more than once (vitest:unit, playwright)",
    ]);
  });

  it("fails the executable guard on an excluded JSX test", () => {
    const result = runInventory({
      tracked: ["src/missed.test.jsx"],
      vitest: [],
      playwright: {},
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "src/missed.test.jsx: not collected by any runner",
    );
  });

  it("normalizes absolute/relative source paths and unions all four browser configs", () => {
    const result = runInventory({
      tracked: [
        "src/a.test.tsx",
        "tests/b.test.cts",
        "browser/local.spec.ts",
        "browser/workspace.spec.ts",
        "browser/staging.spec.ts",
        "browser/prod.spec.ts",
      ],
      vitest: [
        { file: "absolute:src/a.test.tsx", projectName: "unit" },
        { file: "tests/b.test.cts", projectName: "integration" },
      ],
      playwright: {
        [CONFIGS[0]!]: ["browser/local.spec.ts", "browser/local.spec.ts"],
        [CONFIGS[1]!]: ["browser/workspace.spec.ts"],
        [CONFIGS[2]!]: ["absolute:browser/staging.spec.ts"],
        [CONFIGS[3]!]: ["browser/prod.spec.ts"],
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("2 Vitest files, 4 Playwright spec files");
  });

  it("fails the executable guard on a collected but untracked file", () => {
    const result = runInventory({
      tracked: [],
      vitest: [{ file: "absolute:src/untracked.test.ts", projectName: "unit" }],
      playwright: {},
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "src/untracked.test.ts: collected but not tracked by git",
    );
  });
});
