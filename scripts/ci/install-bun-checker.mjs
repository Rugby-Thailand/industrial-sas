#!/usr/bin/env node
// Pinned standalone Bun type checker for `pnpm typecheck` (delivery plan T01).
//
//   node scripts/ci/install-bun-checker.mjs           install, then verify
//   node scripts/ci/install-bun-checker.mjs --verify  verify the `bun` on PATH
//
// Install downloads the official release archive for this platform and checks
// its SHA-256 against the digest pinned below before extracting anything. It
// extracts only the `bun` executable into .cache/bun-checker/ (ignored) and
// requires the exact pinned Bun and embedded TypeScript versions. No installer
// script runs and nothing is piped to a shell. Only the archive is cached; its
// bytes are verified again on every use. On GitHub Actions the directory is
// appended to GITHUB_PATH for later steps.
//
// `pnpm typecheck` runs --verify first: a missing `bun` on PATH, or one that
// reports a different Bun or embedded TypeScript version, fails instead of
// silently checking with another version. --verify trusts what the selected
// binary reports; it does not rehash it. Archive integrity is verified only
// by install, against the pinned digest.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BUN_CHECKER = Object.freeze({
  version: "1.4.3",
  typescript: "7.0.2",
  // GitHub release-asset digests for bun-v1.4.3, matching the release's
  // SHASUMS256.txt. Another platform or version needs a reviewed digest here.
  sha256: Object.freeze({
    "linux-x64":
      "3e730528d89775f03f87f05c06787c4df4099d0a37f3f252e7b829cb23816e18",
    "darwin-arm64":
      "80afd4c069b46a6fa8f3ec520bebc750a7843e4a8d5b9583d29ad436c00a3403",
  }),
});
const RELEASE_TARGETS = Object.freeze({
  "linux-x64": "linux-x64",
  "darwin-arm64": "darwin-aarch64",
});
export const INSTALL_HINT = "node scripts/ci/install-bun-checker.mjs";

/** The pinned archive for a Node platform/arch pair; throws when unpinned. */
export function bunAsset(platform, arch) {
  const key = `${platform}-${arch}`;
  const sha256 = BUN_CHECKER.sha256[key];
  const target = RELEASE_TARGETS[key];
  if (!sha256 || !target)
    throw new Error(
      `No pinned Bun ${BUN_CHECKER.version} build for ${platform}/${arch}. ` +
        "Add its reviewed release digest to scripts/ci/install-bun-checker.mjs.",
    );
  const name = `bun-${target}`;
  return {
    name,
    sha256,
    url: `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_CHECKER.version}/${name}.zip`,
  };
}

/** Validates .bun-version text; a version without pinned digests is refused. */
export function pinnedVersion(text) {
  const version = String(text).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`.bun-version must be an exact x.y.z version`);
  if (version !== BUN_CHECKER.version)
    throw new Error(
      `.bun-version is ${version} but the installer pins ${BUN_CHECKER.version}; ` +
        "update both together with reviewed digests.",
    );
  return version;
}

/** Problems with a probed `bun`: exact Bun and embedded TypeScript versions. */
export function versionProblems({ version, typescript }) {
  const problems = [];
  if (version !== BUN_CHECKER.version)
    problems.push(
      `Bun ${version || "(none)"} found; ${BUN_CHECKER.version} is required`,
    );
  if (typescript !== BUN_CHECKER.typescript)
    problems.push(
      `embedded TypeScript ${typescript || "(none)"} found; ${BUN_CHECKER.typescript} is required`,
    );
  return problems;
}

/** First executable `bun` in a PATH string, as the shell would select it. */
export function findOnPath(pathValue, name = "bun", cwd = process.cwd()) {
  for (const directory of String(pathValue ?? "").split(delimiter)) {
    const candidate = resolve(cwd, directory, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not present or not executable here; keep searching like the shell.
    }
  }
  return null;
}

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Versions reported by a `bun` executable, run from a neutral directory. */
export function probeBun(binary) {
  // Neutral directory: the probe must not read this repository's config.
  const read = (args) => {
    const result = spawnSync(binary, args, {
      cwd: tmpdir(),
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status === 0 ? result.stdout.trim() : "";
  };
  return {
    version: read(["--version"]),
    typescript: read(["-p", "process.versions.typescript"]),
  };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readPin = () =>
  pinnedVersion(readFileSync(join(root, ".bun-version"), "utf8"));

const CACHE_DIR = ".cache/bun-checker";

/** Directory the installer writes the pinned `bun` executable into. */
export function installedBinDir(
  repositoryRoot = root,
  platform = process.platform,
  arch = process.arch,
) {
  const asset = bunAsset(platform, arch);
  return join(
    repositoryRoot,
    CACHE_DIR,
    `bun-v${BUN_CHECKER.version}-${asset.name}`,
  );
}

/** Cached release archive; its bytes are rehashed on every use. */
export function cachedArchivePath(
  repositoryRoot = root,
  platform = process.platform,
  arch = process.arch,
) {
  const asset = bunAsset(platform, arch);
  return join(
    repositoryRoot,
    CACHE_DIR,
    `${asset.name}-v${BUN_CHECKER.version}.zip`,
  );
}

async function install() {
  const version = readPin();
  const asset = bunAsset(process.platform, process.arch);
  const cache = join(root, CACHE_DIR);
  mkdirSync(cache, { recursive: true });
  const cachedArchive = cachedArchivePath();
  let bytes;
  try {
    bytes = readFileSync(cachedArchive);
  } catch {
    // No cached archive: download below.
  }
  let downloaded = false;
  if (!bytes || sha256Of(bytes) !== asset.sha256) {
    const response = await fetch(asset.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`Bun download failed (HTTP ${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha256Of(bytes) !== asset.sha256)
      throw new Error(`Checksum mismatch for ${asset.name}.zip; not extracted`);
    downloaded = true;
  }

  const binDir = installedBinDir();
  const staging = mkdtempSync(join(cache, "staging-"));
  try {
    // Extract the verified in-memory bytes, never a reopened cache path.
    const archive = join(staging, `${asset.name}.zip`);
    writeFileSync(archive, bytes, { mode: 0o600, flag: "wx" });
    execFileSync(
      "unzip",
      ["-q", "-j", archive, `${asset.name}/bun`, "-d", staging],
      { stdio: ["ignore", "ignore", "inherit"], timeout: 60_000 },
    );
    const binary = join(staging, "bun");
    chmodSync(binary, 0o755);
    const problems = versionProblems(probeBun(binary));
    if (problems.length > 0) throw new Error(problems.join("; "));
    const binarySha256 = sha256Of(readFileSync(binary));
    rmSync(binDir, { recursive: true, force: true });
    mkdirSync(binDir, { recursive: true });
    renameSync(binary, join(binDir, "bun"));
    if (downloaded) renameSync(archive, cachedArchive);
    console.log(
      `Bun ${version} (TypeScript ${BUN_CHECKER.typescript}) installed: ` +
        `${asset.name}.zip sha256 ${asset.sha256}, bun sha256 ${binarySha256}`,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_PATH) {
    appendFileSync(process.env.GITHUB_PATH, `${binDir}\n`);
    console.log("Added the pinned Bun directory to GITHUB_PATH.");
  } else {
    console.log(`Put it first on PATH: export PATH="${binDir}:$PATH"`);
  }
}

function verify() {
  const version = readPin();
  const binary = findOnPath(process.env.PATH);
  if (!binary)
    throw new Error(
      `bun ${version} is not on PATH. Install it: ${INSTALL_HINT}`,
    );
  const problems = versionProblems(probeBun(binary));
  if (problems.length > 0)
    throw new Error(
      `${binary}: ${problems.join("; ")}. Install the pin: ${INSTALL_HINT}`,
    );
  console.log(`Bun checker ${version} (TypeScript ${BUN_CHECKER.typescript})`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--verify")) {
    console.error(`Unknown argument. Usage: ${INSTALL_HINT} [--verify]`);
    process.exit(2);
  }
  try {
    if (args.includes("--verify")) verify();
    else await install();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
