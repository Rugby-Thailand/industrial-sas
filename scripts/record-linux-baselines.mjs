#!/usr/bin/env node
/**
 * Record the `-linux` visual baselines the CI runner compares against.
 *
 * `tests/e2e/visual.preview.e2e.spec.ts` compares screenshots, and Playwright
 * suffixes every baseline with the platform it was recorded on. A developer
 * machine records `-darwin`; `ubuntu-24.04` looks for `-linux` and fails if it
 * is absent — deliberately, because the alternative (letting CI record its own
 * baseline on first run) is a suite that compares against its own output and
 * reports green forever. Somebody therefore has to produce the Linux set on
 * purpose, and this is that step.
 *
 * ### Why a container, and why this one
 *
 * Font rasterisation is the whole game. The same page rendered by the same
 * Chromium produces different pixels under a different FreeType, a different
 * fontconfig, or a different set of installed fonts — and Thai is the worst
 * case, because its combining marks are positioned by the shaper. So the
 * baseline has to come from an environment that matches the runner, not merely
 * from "a Linux":
 *
 * - **The pinned Playwright image**, `v1.62.1-noble`, which is the same Ubuntu
 *   24.04 base and the same font package set the CI job installs, and carries
 *   the browser build that matches `@playwright/test@1.62.1` exactly.
 * - **`linux/amd64`**, because GitHub's `ubuntu-24.04` runner is x86-64. On an
 *   Apple Silicon host this runs under emulation, which is slow and correct;
 *   recording `linux/arm64` baselines instead would be fast and would compare
 *   against pixels no runner will ever produce.
 * - **Node from `.nvmrc`**, installed into the container, because the image
 *   ships a newer Node than this repository allows and `.npmrc` sets
 *   `engine-strict=true`. Running the build on the version CI runs removes the
 *   question rather than answering it.
 *
 * ### Isolation
 *
 * Nothing here touches the working tree except the `-linux` PNGs it copies back.
 * The repository is copied — `git ls-files` plus untracked-but-not-ignored, so
 * `.gitignore` decides and `node_modules`, `.next*`, and build output are
 * excluded by construction — into a temporary directory, and that directory is
 * copied *into* the container rather than bind-mounted. Two reasons: a bind
 * mount would put a Linux `node_modules` full of native binaries inside a path
 * the host also uses, and pnpm's hardlink store behaves differently across a
 * virtualised mount. The container owns its own filesystem; only the PNGs come
 * back.
 *
 * ### Usage
 *
 *     node scripts/record-linux-baselines.mjs
 *
 * Pass `--verify` to compare instead of record: same container, same command
 * minus `--update-snapshots`, nothing copied back. That is the run which proves
 * the committed PNGs are reproducible, because a recording run writes whatever
 * it renders and therefore cannot fail.
 *
 * The Docker endpoint is whatever `DOCKER_HOST`/`DOCKER_CONFIG` name, so any
 * daemon that can run `linux/amd64` works. The image must already be present;
 * this script does not pull, because a multi-gigabyte download is not something
 * a baseline refresh should start without being asked.
 *
 * **On Apple Silicon, the endpoint must emulate x86-64 with Rosetta, not
 * qemu-user.** Measured, not assumed: under qemu-user (Colima's default,
 * `rosetta: false`) every run aborts with
 * `uv__io_poll: Assertion 'errno == EEXIST' failed` moments after `next build`
 * finishes — libuv reads an errno qemu cannot produce faithfully. Neither
 * `UV_USE_IO_URING=0` nor `--security-opt seccomp=unconfined` avoids it. A
 * Rosetta-backed VM (`colima start --arch aarch64 --vm-type vz --vz-rosetta`)
 * runs the same image to completion.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IMAGE = "mcr.microsoft.com/playwright:v1.62.1-noble";
const PLATFORM = "linux/amd64";
const SNAPSHOT_DIR = join(
  "tests",
  "e2e",
  "visual.preview.e2e.spec.ts-snapshots",
);
/** Only these are copied back. Anything else the container produced stays there. */
const KEEP = /-linux\.png$/;

const run = (file, args, options = {}) =>
  execFileSync(file, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

const die = (message) => {
  process.stderr.write(`record-linux-baselines: ${message}\n`);
  process.exit(1);
};

/** The Node major this repository pins, read from `.nvmrc` rather than repeated. */
function nodeVersion() {
  const major = run("cat", [".nvmrc"]).trim();
  /*
   * Resolved to a concrete patch the same way `actions/setup-node` resolves
   * `node-version-file`: the newest release of that major. Pinning a patch here
   * instead would drift from CI silently the first time Node publishes one.
   */
  const index = JSON.parse(
    run("curl", [
      "-fsSL",
      "--max-time",
      "60",
      "https://nodejs.org/dist/index.json",
    ]),
  );
  const match = index.find((release) =>
    release.version.startsWith(`v${major}.`),
  );
  if (match === undefined) die(`no Node ${major}.x release found`);
  return match.version.slice(1);
}

function assertImagePresent() {
  const found = run("docker", [
    "images",
    "--format",
    "{{.Repository}}:{{.Tag}}",
    IMAGE,
  ]).trim();
  if (found === "") {
    die(
      `image ${IMAGE} is not present on this Docker endpoint.\n` +
        `  Pull it first: docker pull --platform ${PLATFORM} ${IMAGE}`,
    );
  }
}

/**
 * Every file `.gitignore` does not exclude, copied into a scratch directory.
 *
 * `--cached --others --exclude-standard` is tracked files plus untracked ones
 * git would not ignore, which is exactly "the repository as it stands, without
 * build output". Uncommitted edits are included because they are the thing being
 * recorded against.
 */
function stageRepository() {
  const scratch = mkdtempSync(join(tmpdir(), "ssa-linux-baselines-"));
  const files = run("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter((path) => path !== "");

  for (const relative of files) {
    const target = join(scratch, relative);
    mkdirSync(dirname(target), { recursive: true });
    try {
      copyFileSync(join(ROOT, relative), target);
    } catch (error) {
      // A path git still lists but that no longer exists is not fatal here.
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { scratch, count: files.length };
}

/**
 * `--verify` runs the same container the same way and *compares* instead of
 * recording, copying nothing back.
 *
 * This is what turns "the baselines were produced on Linux" into "the baselines
 * pass on Linux": a recording run cannot fail, because it writes whatever it
 * renders. Only a second pass with `updateSnapshots` left at the config's
 * `"none"` proves the committed PNGs are what this environment actually
 * produces — which is the assertion CI will make on every push.
 */
const VERIFY = process.argv.includes("--verify");

/** The shell the container runs. Everything it needs, in one non-interactive pass. */
const containerScript = (version) => `
set -euo pipefail
echo "==> container $(uname -m), ${VERIFY ? "verifying" : "recording"} against ${IMAGE}"

# .tar.gz rather than the smaller .tar.xz: the Playwright image ships no xz.
curl -fsSL --max-time 300 \
  "https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.gz" \
  -o /tmp/node.tar.gz
mkdir -p /opt/node
tar -xzf /tmp/node.tar.gz -C /opt/node --strip-components=1
export PATH=/opt/node/bin:$PATH
echo "==> node $(node -v)"

corepack enable
corepack prepare pnpm@10.33.2 --activate
echo "==> pnpm $(pnpm -v)"

# The image already carries the browser build for this Playwright version, so the
# install must not try to fetch another one.
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

pnpm install --frozen-lockfile

# CI=1 so the run matches the runner's own concurrency (one worker) — parallel
# workers share a GPU-less renderer and produce marginally different antialiasing.
# In recording mode --update-snapshots overrides the config's "none" from the
# command line, which is the only way this suite is ever allowed to write a
# baseline. In --verify mode it is absent, so "none" applies and a missing or
# mismatched baseline fails exactly as it would on the runner.
echo "==> ${VERIFY ? "verifying" : "recording"}"
CI=1 node scripts/run-e2e.mjs visual.preview${VERIFY ? "" : " --update-snapshots"}
`;

function main() {
  assertImagePresent();
  const version = nodeVersion();
  process.stdout.write(`Node ${version} (from .nvmrc), image ${IMAGE}\n`);

  const { scratch, count } = stageRepository();
  process.stdout.write(`Staged ${count} file(s) in ${scratch}\n`);

  let container = "";
  try {
    container = run("docker", [
      "create",
      "--platform",
      PLATFORM,
      "--workdir",
      "/work",
      // The suite's servers bind inside the container only; nothing is published.
      IMAGE,
      "bash",
      "-lc",
      containerScript(version),
    ]).trim();

    run("docker", ["cp", `${scratch}/.`, `${container}:/work`]);

    const started = spawnSync("docker", ["start", "--attach", container], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (started.status !== 0) {
      die(
        `the ${VERIFY ? "verification" : "recording"} run failed inside the ` +
          `container (exit ${started.status})`,
      );
    }

    if (VERIFY) {
      process.stdout.write(
        "\nThe committed -linux baselines match what this environment renders.\n",
      );
      return;
    }

    /*
     * Copied to a scratch directory first and filtered, rather than straight over
     * the repository's snapshot folder. `docker cp` of a directory would bring
     * back the `-darwin` files the container also had — byte-identical, but
     * rewriting 24 files nobody changed turns a baseline refresh into a diff
     * nobody can review.
     */
    const harvest = mkdtempSync(join(tmpdir(), "ssa-linux-harvest-"));
    run("docker", ["cp", `${container}:/work/${SNAPSHOT_DIR}/.`, harvest]);

    const recorded = readdirSync(harvest).filter((name) => KEEP.test(name));
    if (recorded.length === 0) {
      die("the container produced no -linux baselines");
    }

    const destination = join(ROOT, SNAPSHOT_DIR);
    mkdirSync(destination, { recursive: true });
    for (const name of recorded) {
      cpSync(join(harvest, name), join(destination, name));
    }
    rmSync(harvest, { recursive: true, force: true });

    process.stdout.write(
      `\nCopied ${recorded.length} -linux baseline(s) into ${SNAPSHOT_DIR}\n`,
    );
  } finally {
    if (container !== "") {
      spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
