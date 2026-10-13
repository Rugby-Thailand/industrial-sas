import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BUN_CHECKER,
  bunAsset,
  cachedArchivePath,
  findOnPath,
  installedBinDir,
  pinnedVersion,
  versionProblems,
} from "../../scripts/ci/install-bun-checker.mjs";
import {
  diagnostics,
  fingerprintFiles,
  median,
  portable,
  projectFiles,
  sampleOrder,
  scopeProblems,
} from "../../scripts/benchmark-typecheck.mjs";

const read = (path: string) => readFileSync(path, "utf8");
const manifest = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};
const installer = join(process.cwd(), "scripts/ci/install-bun-checker.mjs");

/** Runs the installer CLI with a minimal environment and the given PATH. */
function runInstaller(
  args: string[],
  { cwd = process.cwd(), path = process.env.PATH ?? "" } = {},
) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd,
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: path },
  });
}

describe("pinned Bun checker", () => {
  it("pins one Bun version and checksum per supported platform", () => {
    expect(pinnedVersion(read(".bun-version"))).toBe("1.4.3");
    expect(BUN_CHECKER).toMatchObject({
      version: "1.4.3",
      typescript: "7.0.2",
    });
    expect(bunAsset("linux", "x64")).toEqual({
      name: "bun-linux-x64",
      sha256:
        "3e730528d89775f03f87f05c06787c4df4099d0a37f3f252e7b829cb23816e18",
      url: "https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/bun-linux-x64.zip",
    });
    expect(bunAsset("darwin", "arm64").name).toBe("bun-darwin-aarch64");
    expect(cachedArchivePath("/r", "linux", "x64")).toBe(
      "/r/.cache/bun-checker/bun-linux-x64-v1.4.3.zip",
    );
    expect(installedBinDir("/r", "linux", "x64")).toBe(
      "/r/.cache/bun-checker/bun-v1.4.3-bun-linux-x64",
    );
    for (const [platform, arch] of [
      ["linux", "arm64"],
      ["darwin", "x64"],
      ["win32", "x64"],
    ])
      expect(() => bunAsset(platform, arch)).toThrow(/No pinned Bun/);
  });

  it("refuses a version file it has no reviewed digests for", () => {
    expect(() => pinnedVersion("1.4.4\n")).toThrow(/pins 1\.4\.3/);
    expect(() => pinnedVersion("latest")).toThrow(/exact x\.y\.z/);
    expect(() => pinnedVersion("1.4")).toThrow(/exact x\.y\.z/);
  });

  it("requires the exact Bun and embedded TypeScript versions", () => {
    expect(versionProblems({ version: "1.4.3", typescript: "7.0.2" })).toEqual(
      [],
    );
    expect(versionProblems({ version: "1.4.2", typescript: "7.0.2" })).toEqual([
      "Bun 1.4.2 found; 1.4.3 is required",
    ]);
    expect(versionProblems({ version: "", typescript: "" })).toHaveLength(2);
  });

  it("keeps the ordinary and fallback checks explicit", () => {
    const { scripts } = manifest;
    expect(scripts.typecheck).toBe(
      "node scripts/ci/install-bun-checker.mjs --verify && next typegen && bun --check --no-pretty",
    );
    expect(scripts["typecheck:ts6"]).toBe("next typegen && tsc --noEmit");
    // Bare `bun check` would dispatch the aggregate `check` script.
    for (const command of Object.values(scripts))
      expect(command).not.toMatch(/\bbun check\b/);
    expect(scripts.check).toBe(
      "pnpm check:navigation && pnpm format:check && pnpm typecheck && pnpm lint && pnpm test",
    );
    // Next runs under Bun with Bun's dotenv preload off (also for workers
    // Next re-spawns, via BUN_OPTIONS); framework flags are unchanged and
    // each default has an explicit Node fallback.
    const bunNext =
      "BUN_OPTIONS=--no-env-file bun run --bun --no-env-file next";
    expect(scripts.build).toBe(`${bunNext} build`);
    expect(scripts.start).toBe(`${bunNext} start --port 3100`);
    expect(scripts["dev:web"]).toBe(`${bunNext} dev --webpack --port 3100`);
    expect(scripts["build:node"]).toBe("next build");
    expect(scripts["start:node"]).toBe("next start --port 3100");
    expect(scripts["dev:web:node"]).toBe("next dev --webpack --port 3100");
    // Tests stay on Node runners; Convex keeps its Node CLI.
    expect(scripts.test).toBe("vitest run");
    expect(scripts["test:e2e"]).toMatch(/^playwright test /);
    expect(scripts["dev:backend"]).toBe("convex dev");
    // TypeScript 6 stays for compiler API consumers and the build gate.
    expect(manifest.devDependencies.typescript).toBe("6.0.3");
    expect(read("next.config.ts")).toMatch(
      /ignoreBuildErrors: process\.env\.CI_EXTERNAL_TYPECHECK === "1"/,
    );
  });
});

describe("install-bun-checker --verify", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  /** A PATH directory whose `bun` reports the given versions. */
  function fakeBun(version: string, typescript: string) {
    const directory = mkdtempSync(join(tmpdir(), "fake-bun-"));
    directories.push(directory);
    writeFileSync(
      join(directory, "bun"),
      [
        "#!/bin/sh",
        `if [ "$1" = "--version" ]; then echo ${version}; exit 0; fi`,
        `if [ "$1" = "-p" ]; then echo ${typescript}; exit 0; fi`,
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    return directory;
  }
  const verify = (path: string, cwd = process.cwd()) =>
    runInstaller(["--verify"], { cwd, path });

  it("accepts only the pinned checker selected first on PATH", () => {
    const pinned = fakeBun("1.4.3", "7.0.2");
    const older = fakeBun("1.4.2", "7.0.2");
    expect(verify(pinned).status).toBe(0);

    const shadowed = verify([older, pinned].join(delimiter));
    expect(shadowed.status).toBe(1);
    expect(shadowed.stderr).toContain("Bun 1.4.2 found; 1.4.3 is required");
    expect(findOnPath([older, pinned].join(delimiter))).toBe(
      join(older, "bun"),
    );

    const wrongCompiler = verify(fakeBun("1.4.3", "7.0.1"));
    expect(wrongCompiler.status).toBe(1);
    expect(wrongCompiler.stderr).toContain("embedded TypeScript 7.0.1");
  });

  it("fails when no bun is on PATH", () => {
    const empty = mkdtempSync(join(tmpdir(), "no-bun-"));
    directories.push(empty);
    const result = verify(empty);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not on PATH");
  });

  it("honors empty PATH components as the current directory", () => {
    const current = fakeBun("1.4.2", "7.0.2");
    const pinned = fakeBun("1.4.3", "7.0.2");
    const absent = join(current, "absent");
    for (const path of [
      `${delimiter}${pinned}`,
      `${absent}${delimiter}`,
      `${absent}${delimiter}${delimiter}${pinned}`,
    ]) {
      expect(findOnPath(path, "bun", current)).toBe(join(current, "bun"));
      const result = verify(path, current);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Bun 1.4.2 found");
    }
    expect(findOnPath(`${pinned}${delimiter}`, "bun", current)).toBe(
      join(pinned, "bun"),
    );
  });

  it("rejects unknown arguments", () => {
    const result = runInstaller(["--version=1.4.4"]);
    expect(result.status).toBe(2);
  });
});

describe("checker comparison harness helpers", () => {
  const root = "/work/repo";

  it("detects content changes even when file names stay the same", () => {
    const directory = mkdtempSync(join(tmpdir(), "checker-fingerprint-"));
    try {
      writeFileSync(join(directory, "source.ts"), "export const a = 1;\n");
      const before = fingerprintFiles(directory, ["source.ts", "missing.ts"]);
      expect(fingerprintFiles(directory, ["missing.ts", "source.ts"])).toEqual(
        before,
      );
      writeFileSync(join(directory, "source.ts"), "export const a = 2;\n");
      expect(
        fingerprintFiles(directory, ["source.ts", "missing.ts"]),
      ).not.toEqual(before);
      writeFileSync(join(directory, "missing.ts"), "export {};\n");
      expect(
        fingerprintFiles(directory, ["source.ts", "missing.ts"]).files[
          "missing.ts"
        ],
      ).not.toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps only repository project inputs from a listing", () => {
    expect(
      projectFiles(
        [
          "bundled:///libs/lib.es5.d.ts",
          "/work/repo/node_modules/next/index.d.ts",
          "/work/repo/src/b.ts",
          "/work/repo/.next/types/routes.d.ts",
          "/work/repo/src/b.ts",
          "/work/repository-other/src/a.ts",
        ].join("\n"),
        root,
      ),
    ).toEqual([".next/types/routes.d.ts", "src/b.ts"]);
  });

  it("parses one-line diagnostics from both checkers", () => {
    expect(
      diagnostics(
        [
          "> next typegen && tsc --noEmit",
          "src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.",
          "Found 1 error in 1 file, checked 2 files [14.00ms]",
        ].join("\n"),
      ),
    ).toEqual([
      {
        file: "src/a.ts",
        line: 1,
        column: 14,
        code: "TS2322",
        message: "Type 'string' is not assignable to type 'number'.",
      },
    ]);
  });

  it("alternates forward and reversed order and takes true medians", () => {
    expect(sampleOrder(["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
    expect(sampleOrder(["a", "b", "c"], 1)).toEqual(["c", "b", "a"]);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("makes recorded paths portable, longest prefix first", () => {
    expect(
      portable(
        { cwd: "/home/me/repo", tmp: "/home/me/tmp/x", other: "/home/me/a" },
        { "/home/me": "<home>", "/home/me/repo": "<repo>" },
      ),
    ).toEqual({ cwd: "<repo>", tmp: "<home>/tmp/x", other: "<home>/a" });
  });

  it("rejects manifests that miss or widen the project scope", () => {
    const manifest = [
      ".next/types/routes.d.ts",
      "convex/a.ts",
      "next-env.d.ts",
      "src/a.ts",
      "tests/a.test.ts",
    ];
    const tracked = ["convex/a.ts", "src/a.ts", "tests/a.test.ts"];
    expect(scopeProblems({ manifest, tracked, untracked: [] })).toEqual([]);
    expect(
      scopeProblems({
        manifest: manifest.filter((file) => file !== "src/a.ts"),
        tracked,
        untracked: ["src/new.ts"],
      }),
    ).toEqual([
      "missing TypeScript: src/a.ts",
      "missing TypeScript: src/new.ts",
      "no inputs under src/",
    ]);
    expect(
      scopeProblems({
        manifest: [...manifest, "coverage/x.ts", ".cache/stray.ts"],
        tracked,
        untracked: [],
      }),
    ).toEqual([
      "excluded path: coverage/x.ts",
      "ignored non-generated input: coverage/x.ts",
      "ignored non-generated input: .cache/stray.ts",
    ]);
  });
});
