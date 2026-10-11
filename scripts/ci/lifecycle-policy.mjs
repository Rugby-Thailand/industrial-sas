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
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
export function inventoryScripts(projectDirectory, scope) {
  const store = join(projectDirectory, "node_modules", ".bun");
  if (!existsSync(store)) throw new Error(`${store} does not exist`);
  const install = [];
  const prepare = [];
  const manifests = [];
  for (const entry of readdirSync(store).sort()) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const modules = join(store, entry, "node_modules");
    if (!existsSync(modules)) continue;
    const names = readdirSync(modules)
      .filter((name) => !name.startsWith("."))
      .flatMap((name) =>
        name.startsWith("@")
          ? readdirSync(join(modules, name)).map((child) => `${name}/${child}`)
          : [name],
      );
    for (const name of names) {
      // Links to sibling store entries are inventoried at their own entry.
      if (lstatSync(join(modules, name)).isSymbolicLink()) continue;
      const file = join(modules, name, "package.json");
      if (!existsSync(file))
        throw new Error(`${relative(projectDirectory, file)} is missing`);
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      const path = relative(projectDirectory, file);
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
        existsSync(join(modules, name, "binding.gyp"))
      )
        install.push({
          scope,
          name: manifest.name,
          version: manifest.version,
          event: "install",
          path,
          body: "node-gyp rebuild (implicit binding.gyp)",
          sha256: sha256("node-gyp rebuild"),
        });
    }
  }
  if (!manifests.length)
    throw new Error(`${store}: no package manifests found`);
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
  if (!Array.isArray(trustedDependencies))
    problems.push(
      `${scope}: trustedDependencies must be declared explicitly (omitting it enables Bun's default trust list)`,
    );
  const entries = (review?.[scope] ?? []).map((entry) => ({
    ...entry,
    seen: false,
  }));
  if (!Array.isArray(review?.[scope]))
    problems.push(`${scope}: no reviewed lifecycle baseline`);
  const trusted = new Set(
    Array.isArray(trustedDependencies) ? trustedDependencies : [],
  );
  for (const row of inventory.install) {
    const match = entries.find(
      (entry) =>
        entry.name === row.name &&
        entry.version === row.version &&
        entry.event === row.event,
    );
    const label = `${scope}: ${row.name}@${row.version} ${row.event} (${row.path})`;
    if (!match) {
      problems.push(`${label}: unreviewed install-time script`);
      continue;
    }
    match.seen = true;
    if (match.sha256 !== row.sha256)
      problems.push(`${label}: script body changed since review`);
    if (match.decision === "blocked" && trusted.has(row.name))
      problems.push(`${label}: reviewed as blocked but trusted`);
    if (match.decision === "trusted" && !trusted.has(row.name))
      problems.push(
        `${label}: reviewed as trusted but not in trustedDependencies`,
      );
    if (match.decision === "trusted" && !(match.paths ?? []).includes(row.path))
      problems.push(
        `${label}: trusted review does not cover this installed path`,
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
  for (const entry of entries)
    if (!entry.seen)
      problems.push(
        `${scope}: reviewed ${entry.name}@${entry.version} ${entry.event} not installed (stale review)`,
      );
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

/** Order-independent digest of the prepare inventory (name@version event hash). */
export function prepareDigest(inventory) {
  const lines = [
    ...new Set(
      inventory.prepare.map(
        (row) => `${row.name}@${row.version} ${row.event} ${row.sha256}`,
      ),
    ),
  ].sort();
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
      const manifest = JSON.parse(
        readFileSync(join(directory, "package.json"), "utf8"),
      );
      const review = JSON.parse(readFileSync(join(root, REVIEW_FILE), "utf8"));
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
