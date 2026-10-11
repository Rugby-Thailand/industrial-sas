#!/usr/bin/env node
// T03 opt-in Bun lifecycle-script policy (pnpm's strictDepBuilds stays the
// enforced install gate).
//
//   node scripts/ci/lifecycle-policy.mjs --scope=app|release --bun-dir=<dir>
//
// Inventories every installed package manifest under node_modules/.bun with
// install-time scripts (preinstall/install/postinstall) and, separately,
// prepare scripts, recording package/version/path/scope and each script
// body's SHA-256. It reads manifests only; it never runs a script. Policy:
//   - candidate package.json must declare `trustedDependencies: []` (Bun's
//     default trust list otherwise runs e.g. esbuild's postinstall);
//   - every install-time script must match a reviewed entry for this scope
//     with the same name, version and body hash; reviewed entries are either
//     `blocked` (must stay blocked) or `trusted` (must appear in
//     trustedDependencies). New, changed or unreviewed scripts fail;
//   - a reviewed entry not found installed is reported (stale review).
// `bun pm untrusted` is not used as evidence: on these pnpm-migrated locks it
// reports 0 untrusted packages despite real blocked install scripts.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readInstalledStore } from "./installed-store.mjs";
import { parseUniqueJson } from "./json-input.mjs";

export const INSTALL_EVENTS = Object.freeze([
  "preinstall",
  "install",
  "postinstall",
]);
export const PREPARE_EVENTS = Object.freeze([
  "preprepare",
  "prepare",
  "postprepare",
]);

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Every materialized package manifest in an isolated Bun store. */
export function inventoryScripts(projectDirectory, scope, options = {}) {
  if (!["app", "release"].includes(scope))
    throw new Error(`Unknown scope ${scope}`);
  const { entries, root: projectRoot } = readInstalledStore(
    projectDirectory,
    "bun",
    options,
  );
  const install = [];
  const prepare = [];
  const manifests = [];
  for (const entry of entries) {
    const { file, manifest } = entry;
    const path = relative(projectRoot, file);
    manifests.push(path);
    for (const [event, body] of Object.entries(manifest.scripts ?? {})) {
      const row = {
        scope,
        name: manifest.name,
        version: manifest.version,
        event,
        path,
        body,
        sha256: sha256(String(body)),
      };
      if (INSTALL_EVENTS.includes(event)) install.push(row);
      else if (PREPARE_EVENTS.includes(event)) prepare.push(row);
    }
    // node-gyp implicit install: binding.gyp without install scripts.
    if (
      !INSTALL_EVENTS.some((event) => manifest.scripts?.[event]) &&
      existsSync(join(entry.directory, "binding.gyp"))
    )
      install.push({
        scope,
        name: manifest.name,
        version: manifest.version,
        event: "install",
        path,
        body: "node-gyp rebuild",
        sha256: sha256("node-gyp rebuild"),
      });
  }
  return { install, prepare, manifests: manifests.length };
}

/** Policy problems for one scope; `review` comes from the reviewed baseline. */
export function lifecycleProblems({
  inventory,
  review,
  scope,
  trustedDependencies,
}) {
  const problems = [];
  if (
    !["app", "release"].includes(scope) ||
    !inventory ||
    !Array.isArray(inventory.install) ||
    !Array.isArray(inventory.prepare)
  )
    return ["Invalid lifecycle scope or inventory schema"];
  const identities = new Set();
  for (const [kind, rows] of [
    ["install", inventory.install],
    ["prepare", inventory.prepare],
  ])
    for (const row of rows) {
      if (
        !row ||
        row.scope !== scope ||
        typeof row.name !== "string" ||
        typeof row.version !== "string" ||
        typeof row.path !== "string" ||
        !row.path.startsWith("node_modules/.bun/") ||
        row.path.split("/").includes("..") ||
        typeof row.body !== "string" ||
        row.sha256 !== sha256(row.body) ||
        !(kind === "install" ? INSTALL_EVENTS : PREPARE_EVENTS).includes(
          row.event,
        )
      )
        return ["Invalid lifecycle row scope/path/body/hash"];
      const identity = JSON.stringify([row.path, row.event]);
      if (identities.has(identity)) return ["Duplicate lifecycle row identity"];
      identities.add(identity);
    }
  if (!Array.isArray(trustedDependencies))
    problems.push(
      `${scope}: trustedDependencies must be declared explicitly (omitting it enables Bun's default trust list)`,
    );
  const entries = (Array.isArray(review?.[scope]) ? review[scope] : []).map(
    (entry) => ({
      ...entry,
      seen: new Set(),
    }),
  );
  if (!Array.isArray(review?.[scope]))
    problems.push(`${scope}: no reviewed lifecycle baseline`);
  const reviewedRows = new Set();
  for (const entry of entries) {
    if (
      typeof entry.name !== "string" ||
      typeof entry.version !== "string" ||
      !INSTALL_EVENTS.includes(entry.event) ||
      typeof entry.body !== "string" ||
      entry.sha256 !== sha256(entry.body) ||
      !Array.isArray(entry.paths) ||
      !entry.paths.length ||
      entry.paths.some(
        (path) =>
          typeof path !== "string" ||
          !path.startsWith("node_modules/.bun/") ||
          path.split("/").includes(".."),
      )
    )
      return [...problems, "Invalid reviewed lifecycle body/path/hash"];
    for (const path of entry.paths) {
      const identity = JSON.stringify([path, entry.event]);
      if (reviewedRows.has(identity))
        return [...problems, "Duplicate reviewed lifecycle path/event"];
      reviewedRows.add(identity);
    }
  }
  const trusted = new Set(
    Array.isArray(trustedDependencies) ? trustedDependencies : [],
  );
  for (const row of inventory.install) {
    const candidates = entries.filter(
      (entry) =>
        entry.name === row.name &&
        entry.version === row.version &&
        entry.event === row.event,
    );
    const match =
      candidates.find((entry) => entry.paths.includes(row.path)) ??
      candidates[0];
    const label = `${scope}: ${row.name}@${row.version} ${row.event} (${row.path})`;
    if (!match) {
      problems.push(`${label}: unreviewed install-time script`);
      continue;
    }
    match.seen.add(row.path);
    if (
      match.sha256 !== row.sha256 ||
      match.body !== row.body ||
      sha256(String(match.body)) !== match.sha256 ||
      sha256(String(row.body)) !== row.sha256
    )
      problems.push(`${label}: script body changed since review`);
    if (match.decision === "blocked" && trusted.has(row.name))
      problems.push(`${label}: reviewed as blocked but trusted`);
    if (match.decision === "trusted" && !trusted.has(row.name))
      problems.push(
        `${label}: reviewed as trusted but not in trustedDependencies`,
      );
    if (!(match.paths ?? []).includes(row.path))
      problems.push(
        `${label}: ${match.decision} review does not cover this installed path`,
      );
    if (!["blocked", "trusted"].includes(match.decision))
      problems.push(`${label}: review decision must be blocked or trusted`);
  }
  for (const name of trusted) {
    const reviewed = entries.filter(
      (entry) => entry.name === name && entry.decision === "trusted",
    );
    if (!reviewed.length)
      problems.push(
        `${scope}: trustedDependencies entry ${name} has no reviewed trusted script in this scope`,
      );
    // Bun trusts by name; any other installed version of that name would run too.
    for (const row of inventory.install.filter((r) => r.name === name))
      if (
        !reviewed.some(
          (entry) =>
            entry.version === row.version && entry.sha256 === row.sha256,
        )
      )
        problems.push(
          `${scope}: trust for ${name} would also run unreviewed ${row.name}@${row.version}`,
        );
  }
  for (const entry of entries) {
    if (
      !Array.isArray(entry.paths) ||
      !entry.paths.length ||
      new Set(entry.paths).size !== entry.paths.length
    )
      problems.push(`${scope}: reviewed paths must be nonempty and unique`);
    for (const path of entry.paths ?? [])
      if (!entry.seen.has(path))
        problems.push(
          `${scope}: reviewed ${entry.name}@${entry.version} ${entry.event} (${path}) not installed (stale review)`,
        );
  }
  // Dependency `prepare` scripts do not run on registry installs, but a
  // changed inventory still needs review before any trust decision.
  const reviewedPrepare = review?.prepare?.[scope];
  const actualPrepare = prepareDigest(inventory);
  if (!reviewedPrepare)
    problems.push(`${scope}: no reviewed prepare-script inventory`);
  else if (
    reviewedPrepare.count !== actualPrepare.count ||
    reviewedPrepare.sha256 !== actualPrepare.sha256
  )
    problems.push(
      `${scope}: prepare-script inventory changed (${reviewedPrepare.count} reviewed, ${actualPrepare.count} installed)`,
    );
  return problems;
}

/** Complete row identity, including scope/path/body and repeated observations. */
export function prepareDigest(inventory) {
  const lines = inventory.prepare
    .map((row) =>
      JSON.stringify([
        row.scope,
        row.name,
        row.version,
        row.event,
        row.path,
        row.body,
        row.sha256,
      ]),
    )
    .sort();
  return { count: lines.length, sha256: sha256(lines.join("\n")) };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REVIEW_FILE = "tests/fixtures/bun-lifecycle/reviewed-scripts.json";

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const match = /^--([a-z-]+)(?:=(.+))?$/.exec(arg);
      return match ? [match[1], match[2] ?? ""] : [arg, ""];
    }),
  );
  if (
    !["app", "release"].includes(args.scope) ||
    !args["bun-dir"] ||
    Object.keys(args).some(
      (key) => !["scope", "bun-dir", "inventory-only"].includes(key),
    )
  ) {
    console.error(
      "Usage: lifecycle-policy.mjs --scope=app|release --bun-dir=<dir> [--inventory-only]",
    );
    process.exit(2);
  }
  try {
    const directory = resolve(args["bun-dir"]);
    const inventory = inventoryScripts(directory, args.scope);
    if ("inventory-only" in args) {
      console.log(JSON.stringify(inventory, null, 2));
    } else {
      const manifest = parseUniqueJson(
        readFileSync(join(directory, "package.json"), "utf8"),
      );
      const review = parseUniqueJson(
        readFileSync(join(root, REVIEW_FILE), "utf8"),
      );
      const problems = lifecycleProblems({
        inventory,
        review,
        scope: args.scope,
        trustedDependencies: manifest.trustedDependencies,
      });
      for (const problem of problems) console.error(problem);
      console.log(
        `${inventory.install.length} install-time and ${inventory.prepare.length} prepare scripts in ${inventory.manifests} manifests (${args.scope}); ${problems.length ? "FAILED" : "passed"}`,
      );
      process.exitCode = problems.length ? 1 : 0;
    }
  } catch (error) {
    console.error(
      `Lifecycle policy failed closed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
