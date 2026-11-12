#!/usr/bin/env node
// Pinned standalone Bun type checker for `pnpm typecheck` (delivery plan T01).
//
//   node scripts/ci/install-bun-checker.mjs              install, then verify
//   node scripts/ci/install-bun-checker.mjs --run <args>  run the pinned bun
//
// Install downloads the official release archive for this platform and checks
// its SHA-256 against the digest pinned below before extracting anything. It
// extracts only the `bun` executable into .cache/bun-checker/ (ignored) and
// requires the exact pinned Bun and embedded TypeScript versions. No installer
// script runs and nothing is piped to a shell. Only the archive is cached; its
// bytes are verified again on every use. On GitHub Actions the directory is
// appended to GITHUB_PATH for later steps.
//
// `pnpm typecheck` uses --run: it runs the installed binary from
// .cache/bun-checker/ directly, never whatever `bun` is on PATH, and installs
// it first when it is missing or reports a different Bun or embedded
// TypeScript version. --run trusts what the installed binary reports; it does
// not rehash it. Archive integrity is verified only by install, against the
// pinned digest.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  }
}

/** Resolves the exact pinned Bun, installing it when absent or incompatible. */
export async function ensurePinnedBun() {
  readPin();
  const binary = join(installedBinDir(), "bun");
  if (versionProblems(probeBun(binary)).length > 0) await install();
  return binary;
}

/** Runs the installed pinned `bun` with `args`, installing it if needed. */
async function run(args) {
  const binary = await ensurePinnedBun();
  const child = spawn(binary, args, { stdio: "inherit" });
  // The launcher is also used for long-running dev servers. Keep its event
  // loop alive so terminating it reaches Bun instead of leaving an orphan.
  const handlers = ["SIGINT", "SIGTERM"].map((signal) => {
    const handler = () => child.kill(signal);
    process.on(signal, handler);
    return [signal, handler];
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        resolve(code ?? (signal ? 128 + constants.signals[signal] : 1)),
      );
    });
    process.exitCode = code;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

// realpath: Node resolves symlinks in import.meta.url but not in argv[1], so
// a checkout under a symlink (macOS /var, /tmp) would otherwise exit 0 here.
let isMain = false;
try {
  isMain =
    Boolean(process.argv[1]) &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch {
  // stdin/eval importers can have a non-file argv[1], such as "-".
}
if (isMain) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== undefined && mode !== "--run") {
    console.error(`Unknown argument. Usage: ${INSTALL_HINT} [--run <args>]`);
    process.exit(2);
  }
  try {
    if (mode === "--run") await run(args);
    else {
      await install();
      console.log(
        `For build/start, put it first on PATH: export PATH="${installedBinDir()}:$PATH"`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
