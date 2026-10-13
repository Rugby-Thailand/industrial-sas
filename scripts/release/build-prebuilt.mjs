#!/usr/bin/env node
// Experimental, deliberately unwired: Linux candidate/runtime proof is pending.
// Executes local build only. No env pull, upload, deploy, or Convex push.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import { loadTargets } from "./lib/env-contract.mjs";
import {
  createBuildReceipt,
  inspectBuildOutput,
  productionBuildConfig,
  productionBuildEnvironment,
} from "./lib/prebuilt.mjs";

const root = process.cwd();
const sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (sha.status !== 0 || sha.stdout.trim() !== process.env.RELEASE_SHA)
  throw new Error("Pure build checkout must match RELEASE_SHA");
const changes = spawnSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { encoding: "utf8" },
);
if (changes.status !== 0 || changes.stdout.trim())
  throw new Error("Pure build requires a clean exact-SHA checkout");
const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf8" });
if (
  bunVersion.status !== 0 ||
  bunVersion.stdout.trim() !==
    readFileSync(resolve(root, ".bun-version"), "utf8").trim() ||
  process.versions.node.split(".")[0] !== "24"
)
  throw new Error("Pure build requires the pinned Bun and Node toolchain");
const config = productionBuildConfig();
const environment = productionBuildEnvironment(process.env);
// Next loads dotenv independently of Bun. A secret env file invalidates purity.
if (
  readdirSync(root).some(
    (name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example",
  )
)
  throw new Error("Pure build refuses local environment files");
if (
  existsSync(resolve(root, ".vercel/.env.production.local")) &&
  readFileSync(resolve(root, ".vercel/.env.production.local"), "utf8").trim()
)
  throw new Error("Pure build refuses pulled production environment files");
const target = loadTargets().targets[environment.RELEASE_ENVIRONMENT];
const cache = resolve(root, ".cache/prebuilt");
mkdirSync(cache, { recursive: true });
mkdirSync(resolve(root, ".vercel"), { recursive: true });
writeFileSync(
  resolve(root, ".vercel/project.json"),
  JSON.stringify({
    projectId: target.vercelProjectId,
    orgId: target.vercelTeamId,
    settings: {
      framework: "nextjs",
      nodeVersion: "24.x",
      buildCommand: config.buildCommand,
      installCommand: config.installCommand,
      outputDirectory: null,
      rootDirectory: null,
    },
  }),
);
writeFileSync(resolve(root, ".vercel/.env.production.local"), "");
writeFileSync(resolve(cache, "vercel.json"), JSON.stringify(config));
const cli = resolve(root, "tools/release/node_modules/.bin/vercel");
const cliPackage = JSON.parse(
  readFileSync(
    resolve(root, "tools/release/node_modules/vercel/package.json"),
    "utf8",
  ),
);
if (cliPackage.version !== "63.1.0")
  throw new Error("Pure build requires pinned Vercel CLI");
const osEnvironment = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "SystemRoot"]
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]]),
);
const started = performance.now();
const result = spawnSync(
  cli,
  [
    "build",
    "--prod",
    "--standalone",
    "--local-config",
    resolve(cache, "vercel.json"),
  ],
  {
    env: { ...osEnvironment, ...environment },
    stdio: "inherit",
    timeout: 15 * 60_000,
  },
);
if (result.status !== 0) throw new Error("Pure production build failed");
const after = spawnSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { encoding: "utf8" },
);
if (after.status !== 0 || after.stdout.trim())
  throw new Error("Pure build modified the release source");
const output = await inspectBuildOutput(resolve(root, ".vercel/output"));
const digest = (data) => createHash("sha256").update(data).digest("hex");
const generated = readdirSync(resolve(root, "convex/_generated"))
  .sort()
  .map(
    (name) =>
      `${name}\0${readFileSync(resolve(root, "convex/_generated", name))}`,
  )
  .join("\0");
const receipt = createBuildReceipt({
  environment,
  output,
  lockfileDigest: digest(readFileSync(resolve(root, "pnpm-lock.yaml"))),
  generatedDigest: digest(generated),
  toolchain: {
    node: process.versions.node,
    nodeMajor: process.versions.node.split(".")[0],
    bun: bunVersion.stdout.trim(),
    vercel: cliPackage.version,
    next: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
      .dependencies.next,
    pnpm: JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ).packageManager.split("@")[1],
    platform: process.platform,
  },
});
receipt.buildSeconds = Math.round((performance.now() - started) * 1000) / 1000;
writeFileSync(
  resolve(root, ".vercel/prebuilt-receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(
  `Pure production output: ${output.files} files, ${output.links} internal links, ${output.bytes} bytes.`,
);
