#!/usr/bin/env node
// Serial TypeScript 6 / Bun checker comparison (delivery plan T01).
//
//   node scripts/benchmark-typecheck.mjs [--samples=10]
//
// Requires `node scripts/ci/install-bun-checker.mjs` first. Writes only
// docs/reviews/bun-elysia/T01/benchmark/. Every process runs sequentially:
// never start other builds, tests or benchmarks while it runs.
//
// 1. Validates pins: Node, pnpm, TypeScript 6.0.3, the installed Bun 1.4.3
//    binary and its embedded TypeScript 7.0.2.
// 2. Compares both checkers' exact project input manifests and validates
//    their scope against git (tracked, untracked and ignored generated files).
// 3. Shows why the scripts use `bun --check`: bare `bun check` dispatches a
//    package's `check` script.
// 4. Injects deliberate errors into src, tests, convex and generated route
//    types, then into an existing file under an incremental TypeScript 6
//    cache. Each must be rejected by both checkers. Cleanup runs in finally.
// 5. Times checker-only and whole-command profiles in alternating forward and
//    reversed order, with the edited-file case measured separately.
//
// Raw evidence replaces machine-specific paths with <repo>, <tmp> and <home>.
// The pilot script this replaces had sha256 PILOT_SCRIPT_SHA256 (T00
// workspace inventory); its exact text is kept beside the evidence.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, homedir, loadavg, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  BUN_CHECKER,
  INSTALL_HINT,
  bunAsset,
  cachedArchivePath,
  installedBinDir,
  pinnedVersion,
  probeBun,
  versionProblems,
} from "./ci/install-bun-checker.mjs";

export const PILOT_SCRIPT_SHA256 =
  "0c988ea34574ee66339c5cffe4fc839aa2590b89c384428b112d80114d1f28eb";
export const OUTPUT_DIR = "docs/reviews/bun-elysia/T01/benchmark";
export const GUARD_DIRECTORIES = ["src", "tests", "convex", ".next/types"];
export const GUARD_FILE = "__typecheck_t01_guard.ts";
const GUARD_SOURCE = 'export const typecheckT01Guard: number = "invalid";\n';
// The fixture subject: imported by application code and the corrected tests.
export const EDIT_TARGET = "src/features/finishedGoods/unitNextAction.ts";
const SCOPE_EXCLUDED = /^(?:node_modules|out|coverage|playwright-report)\//;
const GENERATED = /^(?:\.next\/types\/|next-env\.d\.ts$)/;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in tests/integration/bun-checker.integration.test.ts)
// ---------------------------------------------------------------------------

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Replace machine-specific prefixes, longest first, in text or JSON data. */
export function portable(value, replacements) {
  const pairs = Object.entries(replacements)
    .filter(([from]) => from.length > 1)
    .sort(([a], [b]) => b.length - a.length);
  const text = JSON.stringify(value);
  let result = text;
  for (const [from, to] of pairs) result = result.split(from).join(to);
  return JSON.parse(result);
}

/** Repository-relative project inputs from a `--listFilesOnly` listing. */
export function projectFiles(listing, root) {
  return [
    ...new Set(
      String(listing)
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.startsWith(`${root}/`) && !line.includes("/node_modules/"),
        )
        .map((line) => line.slice(root.length + 1)),
    ),
  ].sort();
}

/** `file(line,col): error TSxxxx: message` lines (tsc --pretty false). */
export function diagnostics(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line) => /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line))
    .filter(Boolean)
    .map(([, file, line, column, code, message]) => ({
      file,
      line: Number(line),
      column: Number(column),
      code,
      message,
    }));
}

/** Forward order on even iterations, reversed on odd ones. */
export function sampleOrder(names, iteration) {
  return iteration % 2 === 0 ? [...names] : [...names].reverse();
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Stable content identity; missing paths are explicit, never silently dropped. */
export function fingerprintFiles(root, paths) {
  const files = Object.fromEntries(
    [...new Set(paths)]
      .sort()
      .map((file) => [
        file,
        existsSync(resolve(root, file))
          ? sha256(readFileSync(resolve(root, file)))
          : null,
      ]),
  );
  return { sha256: sha256(JSON.stringify(files)), files };
}

/**
 * Scope problems for a project manifest. `tracked` are git-tracked paths,
 * `untracked` unignored new paths; anything else must be generated output.
 */
export function scopeProblems({ manifest, tracked, untracked }) {
  const problems = [];
  const inManifest = new Set(manifest);
  const known = new Set([...tracked, ...untracked]);
  for (const file of manifest) {
    if (SCOPE_EXCLUDED.test(file)) problems.push(`excluded path: ${file}`);
    if (!known.has(file) && !GENERATED.test(file))
      problems.push(`ignored non-generated input: ${file}`);
  }
  for (const file of [...tracked, ...untracked])
    if (/\.(?:ts|tsx|mts)$/.test(file) && !SCOPE_EXCLUDED.test(file))
      if (!inManifest.has(file)) problems.push(`missing TypeScript: ${file}`);
  for (const prefix of ["src/", "tests/", "convex/", ".next/types/"])
    if (!manifest.some((file) => file.startsWith(prefix)))
      problems.push(`no inputs under ${prefix}`);
  if (!inManifest.has("next-env.d.ts")) problems.push("next-env.d.ts missing");
  return problems;
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

async function main() {
  const samplesArg = process.argv.slice(2);
  let samplesPerProfile = 10;
  for (const arg of samplesArg) {
    const match = /^--samples=(\d+)$/.exec(arg);
    if (!match || Number(match[1]) < 1) {
      console.error(
        "Usage: node scripts/benchmark-typecheck.mjs [--samples=N]",
      );
      process.exit(2);
    }
    samplesPerProfile = Number(match[1]);
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = resolve(root, OUTPUT_DIR);
  const work = resolve(root, ".cache/typecheck-benchmark-t01");
  const binDir = installedBinDir(root);
  const bun = join(binDir, "bun");
  if (!existsSync(bun)) throw new Error(`Pinned Bun missing. ${INSTALL_HINT}`);
  const tsc = resolve(root, "node_modules/typescript/bin/tsc");
  const neutral = mkdtempSync(join(tmpdir(), "typecheck-t01-"));
  const realTmp = realpathSync(tmpdir());
  const replacements = {
    [root]: "<repo>",
    [realTmp]: "<tmp>",
    [tmpdir()]: "<tmp>",
    [process.execPath]: "<node>",
    [homedir()]: "<home>",
  };
  process.once("exit", () => {
    rmSync(neutral, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };
  // Bun switches to a tagged multi-line format for these; keep tsc lines.
  for (const name of ["AGENT", "CLAUDECODE", "REPL_ID"]) delete env[name];
  mkdirSync(output, { recursive: true });
  rmSync(join(output, "completion.json"), { force: true });
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const write = (name, data) =>
    writeFileSync(
      join(output, name),
      JSON.stringify(portable(data, replacements), null, 2) + "\n",
    );

  function run(command, args, cwd = root) {
    const load = loadavg()[0];
    const start = performance.now();
    const result = spawnSync(command, args, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 300_000,
    });
    if (result.error) throw result.error;
    return {
      command: [command, ...args],
      cwd,
      seconds: (performance.now() - start) / 1000,
      exit: result.status,
      signal: result.signal,
      loadAverage1mBefore: load,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  function pass(command, args, cwd) {
    const result = run(command, args, cwd);
    assert.equal(result.exit, 0, result.stdout + result.stderr);
    return result;
  }
  const node = (args) => [process.execPath, args];
  const git = (args) => pass("git", args).stdout;
  const status = () =>
    git(["status", "--porcelain=v1", "--untracked-files=all"]);

  // --- 1. Pins and conditions ----------------------------------------------
  const startStatus = status();
  const editOriginal = readFileSync(resolve(root, EDIT_TARGET));
  const guards = GUARD_DIRECTORIES.map((dir) => `${dir}/${GUARD_FILE}`);
  for (const file of guards)
    assert.ok(!existsSync(resolve(root, file)), `stale guard ${file}`);

  const probed = probeBun(bun);
  assert.deepEqual(versionProblems(probed), []);
  const asset = bunAsset(process.platform, process.arch);
  const archive = cachedArchivePath(root);
  const manifestJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const versions = {
    node: process.version,
    pnpm: pass("pnpm", ["--version"]).stdout.trim(),
    typescript6: pass(...node([tsc, "--version"])).stdout.trim(),
    next: JSON.parse(
      readFileSync(join(root, "node_modules/next/package.json"), "utf8"),
    ).version,
    bun: probed.version,
    bunRevision: pass(bun, ["--revision"], neutral).stdout.trim(),
    bunEmbeddedTypescript: probed.typescript,
  };
  assert.equal(versions.typescript6, "Version 6.0.3");
  assert.equal(manifestJson.devDependencies.typescript, "6.0.3");
  const pins = {
    bunVersionFile: pinnedVersion(
      readFileSync(join(root, ".bun-version"), "utf8"),
    ),
    installer: BUN_CHECKER,
    asset: {
      ...asset,
      cachedArchiveSha256: existsSync(archive)
        ? sha256(readFileSync(archive))
        : null,
    },
    bunBinary: { path: bun, sha256: sha256(readFileSync(bun)) },
    scripts: {
      typecheck: manifestJson.scripts.typecheck,
      "typecheck:ts6": manifestJson.scripts["typecheck:ts6"],
      check: manifestJson.scripts.check,
      build: manifestJson.scripts.build,
    },
  };
  assert.equal(pins.asset.cachedArchiveSha256, asset.sha256);
  assert.match(pins.scripts.typecheck, /&& bun --check --no-pretty$/);
  assert.doesNotMatch(JSON.stringify(manifestJson.scripts), /\bbun check\b/);

  const pilotCopy = join(output, "pilot-benchmark-typecheck.mjs.txt");
  const environment = {
    recordedAt: new Date().toISOString(),
    commit: git(["rev-parse", "HEAD"]).trim(),
    originMain: git(["rev-parse", "origin/main"]).trim(),
    workingTreeAtStart: startStatus.split("\n").filter(Boolean),
    versions,
    pins,
    host: {
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      cpuModel: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryGiB: Math.round(totalmem() / 2 ** 30),
      loadAverageAtStart: loadavg(),
    },
    conditions: {
      NODE_ENV: process.env.NODE_ENV ?? null,
      CI: process.env.CI ?? null,
      NO_COLOR: process.env.NO_COLOR !== undefined,
      // Presence only; contents are never read.
      envFilesPresent: [".env", ".env.local", ".env.production"].filter(
        (file) => existsSync(join(root, file)),
      ),
      nextBuildCachePresent: existsSync(join(root, ".next/cache")),
      routeTypes:
        "pnpm exec next typegen before manifests, error and timing runs (production build phase config load)",
      typescript6Caches: {
        full: "--incremental false: no build info read or written",
        cached:
          "primed --tsBuildInfoFile under .cache/typecheck-benchmark-t01; no source change between samples",
        edited: `separate primed build info; ${EDIT_TARGET} gains a new unique export before each sample and is restored after it`,
        commandCached:
          "pnpm typecheck:ts6 with the project's default tsconfig.tsbuildinfo, primed before timing",
      },
      bun: "bun --check never reads or writes build info: every run checks the whole project",
      filesystem:
        "warm; dependencies installed by pnpm install --frozen-lockfile before the run",
      concurrency:
        "one process at a time; no other build, test or benchmark started by this task during the run; other workstation activity uncontrolled (1-minute load average recorded per sample)",
    },
    provenance: {
      replaces:
        "untracked pilot scripts/benchmark-typecheck.mjs from the checker worktree",
      pilotScriptSha256: PILOT_SCRIPT_SHA256,
      pilotCopy: existsSync(pilotCopy)
        ? {
            file: "pilot-benchmark-typecheck.mjs.txt",
            sha256: sha256(readFileSync(pilotCopy)),
          }
        : null,
      harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      historicalEvidence:
        "docs/reviews/assets/bun-typecheck-pilot-2026-10-11 (unchanged)",
    },
  };
  if (environment.provenance.pilotCopy)
    assert.equal(environment.provenance.pilotCopy.sha256, PILOT_SCRIPT_SHA256);
  write("environment.json", environment);

  const typegen = pass("pnpm", ["exec", "next", "typegen"]);

  // --- 2. Manifests ----------------------------------------------------------
  // `bun check` with informational flags, from a neutral directory: in this
  // repository bare `bun check` would run the aggregate `check` script, and
  // `bun --check --listFilesOnly` prints no listing.
  writeFileSync(join(neutral, "package.json"), '{ "private": true }\n');
  const listings = {
    typescript6: pass(...node([tsc, "--listFilesOnly"])),
    bun: pass(
      bun,
      [
        "check",
        "-p",
        join(root, "tsconfig.json"),
        "--listFilesOnly",
        "--no-pretty",
      ],
      neutral,
    ),
  };
  const manifests = Object.fromEntries(
    Object.entries(listings).map(([name, result]) => [
      name,
      projectFiles(result.stdout, root),
    ]),
  );
  const tracked = git(["ls-files"]).split("\n").filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
  const scope = scopeProblems({
    manifest: manifests.typescript6,
    tracked,
    untracked,
  });
  const byTop = (list) =>
    list.reduce((counts, file) => {
      const top = file.startsWith(".next/types/")
        ? ".next/types"
        : file.split("/")[0];
      counts[top] = (counts[top] ?? 0) + 1;
      return counts;
    }, {});
  const comparison = {
    identical:
      JSON.stringify(manifests.bun) === JSON.stringify(manifests.typescript6),
    counts: {
      typescript6: manifests.typescript6.length,
      bun: manifests.bun.length,
    },
    onlyTypescript6: manifests.typescript6.filter(
      (file) => !manifests.bun.includes(file),
    ),
    onlyBun: manifests.bun.filter(
      (file) => !manifests.typescript6.includes(file),
    ),
    byTopLevel: byTop(manifests.typescript6),
    untrackedInputs: manifests.typescript6.filter((file) =>
      untracked.includes(file),
    ),
    generatedInputs: manifests.typescript6.filter(
      (file) => !tracked.includes(file) && !untracked.includes(file),
    ),
    scopeProblems: scope,
    excludedFromManifests:
      "dependency files (node_modules) and bundled/installed standard-library declarations: Bun embeds TypeScript 7 libraries, TypeScript 6 uses its installed ones",
    listingCommands: {
      typescript6: listings.typescript6.command,
      bun: listings.bun.command,
      bunCwd: 'neutral temporary directory containing only {"private":true}',
    },
    listingStderr: {
      typescript6: listings.typescript6.stderr,
      bun: listings.bun.stderr,
    },
  };
  write("project-files-typescript6.json", manifests.typescript6);
  write("project-files-bun.json", manifests.bun);
  write("manifest-comparison.json", comparison);
  assert.ok(comparison.identical, "checker manifests differ");
  assert.deepEqual(scope, []);

  // Freeze every tracked/unignored file except this run's evidence, all
  // generated route types, and the installed declarations selected by TS6.
  // This includes source, fixtures, locks, configuration and the harness.
  const installedInputs = listings.typescript6.stdout
    .split(/\r?\n/)
    .filter((file) => file.startsWith(`${root}/`))
    .map((file) => file.slice(root.length + 1));
  const generatedFiles = (directory = ".next/types") => {
    if (!existsSync(resolve(root, directory))) return [];
    return readdirSync(resolve(root, directory), {
      withFileTypes: true,
    }).flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      return entry.isDirectory() ? generatedFiles(file) : [file];
    });
  };
  const fingerprint = () =>
    fingerprintFiles(root, [
      ...git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean)
        .filter((file) => !file.startsWith(`${OUTPUT_DIR}/`)),
      ...installedInputs,
      ...generatedFiles(),
    ]);
  const frozenInputs = fingerprint();
  write("input-fingerprint-before.json", frozenInputs);
  console.log(
    `Both checkers select the same ${manifests.bun.length} project inputs; scope OK.`,
  );

  // --- 3. Script-collision probe --------------------------------------------
  const collision = mkdtempSync(join(tmpdir(), "bun-check-collision-"));
  let collisionResult;
  try {
    writeFileSync(
      join(collision, "package.json"),
      JSON.stringify({
        private: true,
        scripts: { check: "echo AGGREGATE_CHECK_SCRIPT_RAN" },
      }),
    );
    writeFileSync(
      join(collision, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true },
        include: ["*.ts"],
      }),
    );
    writeFileSync(join(collision, "invalid.ts"), GUARD_SOURCE);
    collisionResult = {
      bareBunCheck: run(bun, ["check", "--no-pretty"], collision),
      bunDashDashCheck: run(bun, ["--check", "--no-pretty"], collision),
    };
  } finally {
    rmSync(collision, { recursive: true, force: true });
  }
  assert.equal(collisionResult.bareBunCheck.exit, 0);
  assert.match(
    collisionResult.bareBunCheck.stdout,
    /AGGREGATE_CHECK_SCRIPT_RAN/,
  );
  assert.equal(collisionResult.bunDashDashCheck.exit, 1);
  assert.match(
    collisionResult.bunDashDashCheck.stdout,
    /invalid\.ts\(1,14\): error TS2322/,
  );
  write("collision-probe.json", {
    finding:
      "With a package `check` script, bare `bun check` ran the script and exited 0 despite a type error; `bun --check` type-checked and exited 1.",
    ...collisionResult,
  });

  // --- 4. Deliberate errors --------------------------------------------------
  const full = ["--noEmit", "--incremental", "false", "--pretty", "false"];
  const checkers = {
    typescript6: node([tsc, ...full]),
    bun: [bun, ["--check", "--no-pretty"]],
  };
  const rejection = {
    guardSource: GUARD_SOURCE,
    guards,
    checkers: {},
    commands: {},
  };
  const created = [];
  try {
    for (const file of guards) {
      writeFileSync(resolve(root, file), GUARD_SOURCE, { flag: "wx" });
      created.push(file);
    }
    for (const [name, [command, args]] of Object.entries(checkers)) {
      const result = run(command, args);
      const found = diagnostics(result.stdout);
      assert.notEqual(result.exit, 0, `${name} accepted deliberate errors`);
      for (const file of guards)
        assert.ok(
          found.some(
            (d) =>
              d.file === file &&
              d.line === 1 &&
              d.column === 14 &&
              d.code === "TS2322",
          ),
          `${name} missed ${file}`,
        );
      rejection.checkers[name] = { ...result, diagnostics: found };
    }
    const key = (d) => `${d.file}(${d.line},${d.column}) ${d.code}`;
    const [ts6, bunFound] = [
      rejection.checkers.typescript6.diagnostics,
      rejection.checkers.bun.diagnostics,
    ];
    rejection.sameLocationsAndCodes =
      JSON.stringify(ts6.map(key).sort()) ===
      JSON.stringify(bunFound.map(key).sort());
    rejection.sameMessages =
      JSON.stringify(ts6.map((d) => key(d) + d.message).sort()) ===
      JSON.stringify(bunFound.map((d) => key(d) + d.message).sort());
    assert.ok(rejection.sameLocationsAndCodes);
    // Whole commands must retain and reject the generated guard after typegen.
    for (const [name, args] of Object.entries({
      bun: ["typecheck"],
      typescript6: [
        "typecheck:ts6",
        "--incremental",
        "false",
        "--pretty",
        "false",
      ],
    })) {
      const result = run("pnpm", args);
      const found = diagnostics(result.stdout);
      assert.notEqual(
        result.exit,
        0,
        `pnpm ${args[0]} accepted deliberate errors`,
      );
      assert.ok(
        existsSync(resolve(root, guards[3])),
        "typegen removed generated guard",
      );
      for (const file of guards)
        assert.ok(
          found.some((d) => d.file === file && d.code === "TS2322"),
          `pnpm ${args[0]} missed ${file}`,
        );
      rejection.commands[name] = {
        ...result,
        diagnostics: found,
        generatedGuardSurvivedTypegen: existsSync(resolve(root, guards[3])),
        generatedGuardReported: found.some((d) => d.file === guards[3]),
      };
    }
  } finally {
    for (const file of created) rmSync(resolve(root, file), { force: true });
  }
  for (const file of guards) assert.ok(!existsSync(resolve(root, file)));
  write("error-rejection.json", rejection);
  console.log(
    "Both checkers reject deliberate errors in src, tests, convex and generated route types.",
  );

  // --- 5. Edited existing file under an incremental TypeScript 6 cache ------
  const editedCache = join(work, "ts6-edited.tsbuildinfo");
  const cachedCache = join(work, "ts6-cached.tsbuildinfo");
  const incremental = (cache) =>
    node([tsc, "--noEmit", "--tsBuildInfoFile", cache, "--pretty", "false"]);
  const target = resolve(root, EDIT_TARGET);
  const restore = () => writeFileSync(target, editOriginal);
  const editLine = editOriginal.toString("utf8").split("\n").length;
  const edited = { file: EDIT_TARGET, originalSha256: sha256(editOriginal) };
  try {
    edited.prime = pass(...incremental(editedCache));
    writeFileSync(
      target,
      Buffer.concat([editOriginal, Buffer.from(GUARD_SOURCE)]),
    );
    edited.invalid = {};
    for (const [name, [command, args]] of Object.entries({
      typescript6Incremental: incremental(editedCache),
      bun: checkers.bun,
    })) {
      const result = run(command, args);
      const found = diagnostics(result.stdout);
      assert.notEqual(result.exit, 0, `${name} accepted the edited-file error`);
      assert.ok(
        found.some(
          (d) =>
            d.file === EDIT_TARGET &&
            d.line === editLine &&
            d.code === "TS2322",
        ),
        `${name} missed the edited-file error`,
      );
      edited.invalid[name] = { ...result, diagnostics: found };
    }
    restore();
    edited.restored = {
      typescript6Incremental: pass(...incremental(editedCache)),
      bun: pass(...checkers.bun),
    };
  } finally {
    restore();
  }
  assert.equal(sha256(readFileSync(target)), edited.originalSha256);
  edited.finding =
    "After an edit to an existing file, both the incremental TypeScript 6 check and Bun rejected the new error; after restoring the file both passed (no stale cached diagnostic).";
  write("edited-file.json", edited);

  // --- 6. Timing ---------------------------------------------------------------
  const scriptCache = join(root, "tsconfig.tsbuildinfo");
  const primes = {
    checkerTypescript6Cached: pass(...incremental(cachedCache)),
    commandTypescript6Cached: pass("pnpm", [
      "typecheck:ts6",
      "--pretty",
      "false",
    ]),
    scriptCacheFile: existsSync(scriptCache) ? "tsconfig.tsbuildinfo" : null,
  };
  let editCount = 0;
  const withEdit = (fn) => () => {
    editCount += 1;
    writeFileSync(
      target,
      Buffer.concat([
        editOriginal,
        Buffer.from(
          `export const typecheckBenchmarkEdit${editCount} = ${editCount};\n`,
        ),
      ]),
    );
    try {
      return fn();
    } finally {
      restore();
    }
  };
  const profiles = {
    "checker-ts6-full": () => pass(...checkers.typescript6),
    "checker-ts6-cached": () => pass(...incremental(cachedCache)),
    "checker-ts6-edited": withEdit(() => pass(...incremental(editedCache))),
    "checker-bun": () => pass(...checkers.bun),
    "checker-bun-edited": withEdit(() => pass(...checkers.bun)),
    "next-typegen": () => pass("pnpm", ["exec", "next", "typegen"]),
    "command-ts6-full": () =>
      pass("pnpm", [
        "typecheck:ts6",
        "--incremental",
        "false",
        "--pretty",
        "false",
      ]),
    "command-ts6-cached": () =>
      pass("pnpm", ["typecheck:ts6", "--pretty", "false"]),
    "command-bun": () => pass("pnpm", ["typecheck"]),
  };
  const names = Object.keys(profiles);
  assert.deepEqual(
    fingerprint(),
    frozenInputs,
    "candidate changed during correctness probes",
  );
  const samples = [];
  try {
    for (let iteration = 0; iteration < samplesPerProfile; iteration++) {
      for (const name of sampleOrder(names, iteration)) {
        const result = profiles[name]();
        samples.push({ profile: name, iteration: iteration + 1, ...result });
        console.log(`${name} ${iteration + 1}: ${result.seconds.toFixed(3)}s`);
      }
    }
  } finally {
    restore();
  }
  const summary = Object.fromEntries(
    names.map((name) => {
      const values = samples
        .filter((s) => s.profile === name)
        .map((s) => s.seconds);
      return [
        name,
        {
          samples: values.length,
          medianSeconds: median(values),
          minSeconds: Math.min(...values),
          maxSeconds: Math.max(...values),
        },
      ];
    }),
  );
  const ratio = (a, b) => summary[a].medianSeconds / summary[b].medianSeconds;
  const results = {
    method: `${samplesPerProfile} serial samples per profile; profile order forward on odd iterations and reversed on even ones. Wall-clock time of each child process (pnpm commands include pnpm startup). Edited samples add a unique export to ${EDIT_TARGET} before the timed process and restore it afterwards (not timed).`,
    profiles: Object.fromEntries(
      names.map((name) => [
        name,
        samples.find((s) => s.profile === name).command,
      ]),
    ),
    primes,
    summary,
    medianRatios: {
      checkerFullTs6OverBun: ratio("checker-ts6-full", "checker-bun"),
      checkerCachedTs6OverBun: ratio("checker-ts6-cached", "checker-bun"),
      checkerEditedTs6OverBunEdited: ratio(
        "checker-ts6-edited",
        "checker-bun-edited",
      ),
      commandFullTs6OverBun: ratio("command-ts6-full", "command-bun"),
      commandCachedTs6OverBun: ratio("command-ts6-cached", "command-bun"),
    },
    limits:
      "Local macOS arm64 workstation only. Not a CI, production build, application runtime or provider latency measurement.",
    samples,
  };
  assert.equal(sha256(readFileSync(target)), edited.originalSha256);
  // Only this run's evidence may have changed the working tree.
  const unrelated = (text) =>
    text
      .split("\n")
      .filter((line) => line && !line.includes(`${OUTPUT_DIR}/`))
      .join("\n");
  assert.equal(unrelated(status()), unrelated(startStatus));
  const finalInputs = fingerprint();
  write("input-fingerprint-after.json", finalInputs);
  assert.deepEqual(
    finalInputs,
    frozenInputs,
    "measured candidate content changed",
  );
  assert.equal(sha256(readFileSync(bun)), pins.bunBinary.sha256);
  write("benchmarks.json", results);
  write("completion.json", {
    completedAt: new Date().toISOString(),
    commit: environment.commit,
    harnessSha256: environment.provenance.harnessSha256,
    inputSha256: frozenInputs.sha256,
    samples: samples.length,
    samplesPerProfile,
    allAssertionsPassed: true,
    externalExitCaptureRequired: true,
  });
  console.log(
    JSON.stringify({ summary, medianRatios: results.medianRatios }, null, 2),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
