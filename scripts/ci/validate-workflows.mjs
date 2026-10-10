#!/usr/bin/env node
// Workflow validation for the `validate` job (CI-11/S2).
//
//   node scripts/ci/validate-workflows.mjs [--verify-pins] [--skip-actionlint]
//
// 1. Repository policy (scripts/ci/workflow-lib.mjs): pins and allowlist,
//    permissions, secret scoping, the stable `check` contract, release jobs,
//    the shared production lock and the dependency-review exception list.
// 2. --verify-pins: every pinned SHA must be the commit its "# vX.Y.Z" tag
//    resolves to upstream (git ls-remote; public metadata only).
// 3. actionlint at an exact release, verified against a pinned SHA-256
//    before extraction. Nothing is executed until the checksum matches. It
//    lints a temporary copy in which only strictly validated
//    `concurrency.queue` lines are blanked (actionlint 1.7.12 predates that
//    documented key); line numbers and every other diagnostic are preserved.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIONLINT,
  actionReferences,
  actionlintAsset,
  normalizeConcurrencyQueue,
  tagCommit,
  workflowPolicyProblems,
} from "./workflow-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!["--verify-pins", "--skip-actionlint"].includes(arg)) {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

const workflowDir = join(root, ".github/workflows");
const workflows = Object.fromEntries(
  readdirSync(workflowDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => [name, readFileSync(join(workflowDir, name), "utf8")]),
);
const actionsDir = join(root, ".github/actions");
const actions = Object.fromEntries(
  (existsSync(actionsDir) ? readdirSync(actionsDir) : [])
    .sort()
    .flatMap((name) =>
      ["action.yml", "action.yaml"]
        .map((file) => join(actionsDir, name, file))
        .filter(existsSync)
        .map((path) => [
          `actions/${name}/${path.split("/").at(-1)}`,
          readFileSync(path, "utf8"),
        ]),
    ),
);
const exceptions = JSON.parse(
  readFileSync(join(root, "scripts/ci/dependency-exceptions.json"), "utf8"),
);

const problems = workflowPolicyProblems({
  workflows,
  actions,
  exceptions,
  now: Date.now(),
});

if (args.has("--verify-pins")) {
  const pins = new Map();
  for (const [name, text] of Object.entries({ ...workflows, ...actions })) {
    for (const reference of actionReferences(text)) {
      if (reference.local || !/^[0-9a-f]{40}$/.test(reference.sha ?? ""))
        continue;
      const key = `${reference.repository}@${reference.version}`;
      const entry = pins.get(key) ?? { ...reference, files: new Set() };
      entry.files.add(name);
      if (entry.sha !== reference.sha)
        problems.push(`${key}: pinned to different SHAs across files`);
      pins.set(key, entry);
    }
  }
  for (const [key, pin] of [...pins].sort()) {
    let output = "";
    try {
      output = execFileSync(
        "git",
        [
          "ls-remote",
          `https://github.com/${pin.repository}.git`,
          `refs/tags/${pin.version}`,
          `refs/tags/${pin.version}^{}`,
        ],
        {
          encoding: "utf8",
          timeout: 30_000,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        },
      );
    } catch {
      problems.push(`${key}: upstream tag lookup failed`);
      continue;
    }
    const commit = tagCommit(output, pin.version);
    if (commit !== pin.sha)
      problems.push(
        `${key}: pinned ${pin.sha} but tag resolves to ${commit ?? "nothing"}`,
      );
    else console.log(`pin ok: ${key} ${pin.sha}`);
  }
}

async function actionlintBinary(executionRoot) {
  const asset = actionlintAsset(process.platform, process.arch);
  // Only the archive is cached. Its bytes are untrusted until reverified;
  // an independently mutable executable in a shared cache is never run.
  const cachedArchive = join(
    tmpdir(),
    `actionlint-${ACTIONLINT.version}-${asset.sha256}.tar.gz`,
  );
  let bytes;
  try {
    bytes = readFileSync(cachedArchive);
  } catch {
    // An absent or unreadable cache never grants executable authority.
  }
  const digest = (content) =>
    createHash("sha256").update(content).digest("hex");
  let downloadedFresh = false;
  if (!bytes || digest(bytes) !== asset.sha256) {
    const response = await fetch(asset.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`actionlint download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== asset.sha256)
      throw new Error(`actionlint checksum mismatch for ${asset.name}`);
    downloadedFresh = true;
  }
  // The caller owns this private directory until execution completes, and
  // removes it on success or failure. Read and verify once, then extract that
  // exact in-memory archive rather than reopening a mutable cache pathname.
  const staging = mkdtempSync(join(executionRoot, "actionlint-binary-"));
  const downloaded = join(staging, asset.name);
  writeFileSync(downloaded, bytes, { mode: 0o600, flag: "wx" });
  execFileSync("tar", ["-xzf", downloaded, "-C", staging, "actionlint"], {
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 30_000,
  });
  const binary = join(staging, "actionlint");
  chmodSync(binary, 0o700);
  // Atomic replacement also replaces a cache leaf symlink instead of writing
  // through it. The cache never receives an executable.
  if (downloadedFresh) renameSync(downloaded, cachedArchive);
  return binary;
}

let actionlintFailed = false;
if (!args.has("--skip-actionlint")) {
  const copy = mkdtempSync(join(tmpdir(), "actionlint-workflows-"));
  try {
    const binary = await actionlintBinary(copy);
    // actionlint resolves local composite actions relative to a git project.
    execFileSync("git", ["init", "-q", copy], { stdio: "ignore" });
    for (const [name, text] of Object.entries(workflows)) {
      mkdirSync(join(copy, ".github/workflows"), { recursive: true });
      writeFileSync(
        join(copy, ".github/workflows", name),
        normalizeConcurrencyQueue(name, text).text,
      );
    }
    for (const [name, text] of Object.entries(actions)) {
      const target = join(copy, ".github", name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    const result = spawnSync(
      binary,
      Object.keys(workflows).map((name) => `.github/workflows/${name}`),
      { cwd: copy, stdio: "inherit", timeout: 120_000 },
    );
    if (result.status !== 0) {
      actionlintFailed = true;
      console.error(`actionlint ${ACTIONLINT.version} reported problems.`);
    } else {
      console.log(`actionlint ${ACTIONLINT.version}: no problems.`);
    }
  } catch (error) {
    actionlintFailed = true;
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

if (problems.length > 0) {
  console.error("Workflow policy problems:");
  for (const problem of problems) console.error(`  ${problem}`);
}
if (problems.length > 0 || actionlintFailed) process.exit(1);
console.log(
  `Workflow policy OK: ${Object.keys(workflows).length} workflows, ` +
    `${Object.keys(actions).length} composite actions.`,
);
