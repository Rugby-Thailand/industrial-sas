#!/usr/bin/env node
// Regenerates convex/_generated against a throwaway, credential-free local
// Convex backend and fails if the committed files differ (CI-08 / BD-04).
//
// `convex codegen --dry-run` exits 0 even when output would change, and
// codegen refuses preview deploy keys, so this script uses the pinned CLI's
// owned local deployment instead. No Convex account, deploy key or cloud
// deployment is involved. A verified fixed binary binds loopback only; its
// process, local key and data live only for this check in a private HOME.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GENERATED = "convex/_generated";

/** Content hash of every file under convex/_generated, by relative path. */
function snapshot() {
  const files = new Map();
  for (const name of readdirSync(GENERATED, { recursive: true })) {
    const path = join(GENERATED, String(name));
    // Inspect and hash the same opened inode. Do not follow a replaced leaf
    // symlink or block on a FIFO in a concurrently changed generated tree.
    const descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const metadata = fstatSync(descriptor);
      if (metadata.isDirectory()) continue;
      if (!metadata.isFile())
        throw new Error("CODEGEN_NON_REGULAR_GENERATED_FILE");
      files.set(
        path,
        createHash("sha256").update(readFileSync(descriptor)).digest("hex"),
      );
    } finally {
      closeSync(descriptor);
    }
  }
  return files;
}

function changedPaths(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

// Bump together with the `convex` npm package (monthly toolchain review).
const LOCAL_BACKEND_VERSION = "precompiled-2026-10-06-a3538c6";
// GitHub's SHA256 digests for this exact release, independently read on
// 2026-10-10 from /repos/get-convex/convex-backend/releases/tags/<version>.
// Never resolve "latest" or reuse a caller cache. Update with the Convex pin.
const ASSETS = {
  "darwin-arm64": [
    "aarch64-apple-darwin",
    "f89a9dc8189148b0aa67b50dbcb202ce429b541df83e36cab4438c2b7955d5c2",
  ],
  "darwin-x64": [
    "x86_64-apple-darwin",
    "a9465ddf5535392a3ae9bd5f9aab49e5067927f2b27e8fdb45fe1317d7b42f6d",
  ],
  "linux-arm64": [
    "aarch64-unknown-linux-gnu",
    "d3bf1d8799d91cecabe144ee2c96348c903ec3f5f88199f375004647b037cc35",
  ],
  "linux-x64": [
    "x86_64-unknown-linux-gnu",
    "eba2eeab62632e0c153e83f9f1c5ada9e98834e2db3386e32f825a3a97f8c093",
  ],
};
// auth.config.ts reads this at push time; any syntactically valid URL works
// because no token is ever verified by this throwaway backend.
const PLACEHOLDER_ISSUER = "https://codegen.invalid";

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

export async function downloadPinnedBackend(
  home,
  env,
  fetchArtifact = fetch,
  stopSignal,
) {
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error("CODEGEN_PLATFORM_UNSUPPORTED");
  const [triple, expected] = asset;
  const url = `https://github.com/get-convex/convex-backend/releases/download/${LOCAL_BACKEND_VERSION}/convex-local-backend-${triple}.zip`;
  let bytes;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchArtifact(url, {
        signal: stopSignal
          ? AbortSignal.any([AbortSignal.timeout(30_000), stopSignal])
          : AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("download failed");
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 100 * 1024 * 1024) throw new Error("oversized asset");
      break;
    } catch {
      if (stopSignal?.aborted) throw new Error("CODEGEN_CHECK_INTERRUPTED");
      if (attempt === 2)
        throw new Error("CODEGEN_PINNED_BACKEND_DOWNLOAD_FAILED");
      await delay(1_000 * (attempt + 1));
    }
  }
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error("CODEGEN_PINNED_BACKEND_CHECKSUM_MISMATCH");
  const archive = join(home, "backend.zip");
  writeFileSync(archive, bytes, { mode: 0o600 });
  // Extract only the verified executable entry, never arbitrary ZIP paths.
  const extracted = spawnSync(
    "unzip",
    ["-q", "-j", archive, "convex-local-backend", "-d", home],
    {
      env,
      stdio: "ignore",
      timeout: 30_000,
    },
  );
  if (extracted.status !== 0)
    throw new Error("CODEGEN_PINNED_BACKEND_EXTRACTION_FAILED");
  const binary = join(home, "convex-local-backend");
  chmodSync(binary, 0o700);
  rmSync(archive);
  return binary;
}

async function unusedPort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

async function stopOwnedBackend(child) {
  const stopped = () => child.exitCode !== null || child.signalCode !== null;
  if (stopped()) return;
  child.kill("SIGTERM");
  for (let count = 0; count < 30 && !stopped(); count += 1) await delay(100);
  if (!stopped()) child.kill("SIGKILL");
  for (let count = 0; count < 20 && !stopped(); count += 1) await delay(100);
  if (!stopped()) throw new Error("CODEGEN_OWNED_BACKEND_STOP_FAILED");
}

/** Injection is a test seam; the executable always uses the verified downloader. */
export async function runCodegenCheck({
  download = downloadPinnedBackend,
} = {}) {
  // Even --env-file does not suppress CONVEX_OVERRIDE_ACCESS_TOKEN. Reject the
  // entire namespace, including future selectors, before creating any state.
  const forbidden = Object.keys(process.env)
    .filter((name) => name.toUpperCase().startsWith("CONVEX_"))
    .sort();
  if (forbidden.length > 0) {
    console.error(
      `Refusing to run codegen check with Convex environment overrides set: ${forbidden.join(", ")}`,
    );
    return 1;
  }
  const existingState = readdirSync(".").filter(
    (name) =>
      name === ".convex" ||
      name === ".env" ||
      (name.startsWith(".env.") && name !== ".env.example"),
  );
  if (existingState.length > 0) {
    console.error(
      `Refusing to reuse existing Convex state or environment files: ${existingState.sort().join(", ")}; run in a clean checkout.`,
    );
    return 1;
  }

  let failed = false;
  let isolatedHome;
  let backend;
  let safeToDelete = true;
  const cancellation = new AbortController();
  const interrupted = () => {
    failed = true;
    cancellation.abort();
    backend?.kill("SIGTERM");
  };
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  try {
    const before = snapshot();
    isolatedHome = mkdtempSync(join(tmpdir(), "convex-codegen-home-"));
    const envFile = join(isolatedHome, "deployment.env");
    const env = {};
    for (const name of [
      "PATH",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "TZ",
      "SystemRoot",
    ]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, {
      HOME: isolatedHome,
      CI: "1",
    });
    const binary = await download(
      isolatedHome,
      env,
      fetch,
      cancellation.signal,
    );
    if (cancellation.signal.aborted)
      throw new Error("CODEGEN_CHECK_INTERRUPTED");
    const instanceSecret = randomBytes(32).toString("hex");
    const instanceName = `anonymous-agent-${randomBytes(8).toString("hex")}`;
    const key = spawnSync(
      binary,
      [
        "keygen",
        "admin-key",
        "--instance-name",
        instanceName,
        "--instance-secret",
        instanceSecret,
      ],
      {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      },
    );
    if (key.status !== 0 || !key.stdout?.trim())
      throw new Error("CODEGEN_LOCAL_KEYGEN_FAILED");
    const cloudPort = await unusedPort();
    let sitePort = await unusedPort();
    while (sitePort === cloudPort) sitePort = await unusedPort();
    const url = `http://127.0.0.1:${cloudPort}`;
    const state = join(isolatedHome, "backend-state");
    mkdirSync(state, { mode: 0o700 });
    backend = spawn(
      binary,
      [
        "--interface",
        "127.0.0.1",
        "--port",
        String(cloudPort),
        "--site-proxy-port",
        String(sitePort),
        "--instance-name",
        instanceName,
        "--instance-secret",
        instanceSecret,
        "--disable-beacon",
        "--local-storage",
        join(state, "storage"),
        join(state, "database.sqlite3"),
      ],
      { env, stdio: "ignore" },
    );
    let spawnFailed = false;
    backend.on("error", () => {
      spawnFailed = true;
    });
    let ready = false;
    for (let count = 0; count < 100; count += 1) {
      if (cancellation.signal.aborted)
        throw new Error("CODEGEN_CHECK_INTERRUPTED");
      if (
        spawnFailed ||
        backend.exitCode !== null ||
        backend.signalCode !== null
      )
        throw new Error("CODEGEN_OWNED_BACKEND_START_FAILED");
      try {
        const response = await fetch(`${url}/instance_name`, {
          redirect: "error",
          signal: AbortSignal.any([
            AbortSignal.timeout(500),
            cancellation.signal,
          ]),
        });
        if (response.ok) {
          if ((await response.text()) !== instanceName)
            throw new Error("CODEGEN_LOCAL_IDENTITY_MISMATCH");
          ready = true;
          break;
        }
      } catch (error) {
        if (cancellation.signal.aborted)
          throw new Error("CODEGEN_CHECK_INTERRUPTED");
        if (error.message === "CODEGEN_LOCAL_IDENTITY_MISMATCH") throw error;
      }
      await delay(100);
    }
    if (!ready) throw new Error("CODEGEN_OWNED_BACKEND_NOT_READY");
    // Tool-created loopback selector/local key only: CLI cannot start another
    // anonymous backend or consult a cloud deployment if this child fails.
    writeFileSync(
      envFile,
      `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${key.stdout.trim()}\n`,
      { mode: 0o600 },
    );
    const convex = (args) => {
      const result = spawnSync(
        "pnpm",
        // Convex 1.46 codegen does not expose --env-file. Node 24 loads our
        // private file before the locked CLI runs, for every command alike.
        [
          "exec",
          "node",
          `--env-file=${envFile}`,
          "node_modules/convex/bin/main.js",
          ...args,
        ],
        {
          env,
          stdio: ["ignore", "inherit", "inherit"],
          timeout: 5 * 60_000,
        },
      );
      if (result.status !== 0) {
        throw new Error(`convex ${args[0]} failed (exit ${result.status})`);
      }
    };
    convex(["env", "set", "CLERK_JWT_ISSUER_DOMAIN", PLACEHOLDER_ISSUER]);
    convex(["codegen", "--typecheck", "disable"]);

    const drift = changedPaths(before, snapshot());
    if (drift.length > 0) {
      failed = true;
      console.error(
        "convex/_generated is stale for the pinned Convex CLI. The regenerated " +
          "files are left in place; review the diff and commit them:",
      );
      for (const path of drift) console.error(`  ${path}`);
    } else {
      console.log("convex/_generated matches the pinned Convex CLI output.");
    }
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    if (backend?.pid !== undefined) {
      try {
        await stopOwnedBackend(backend);
      } catch {
        failed = true;
        safeToDelete = false;
        console.error("CODEGEN_OWNED_BACKEND_STOP_FAILED");
      }
    }
    if (safeToDelete) {
      rmSync(".env.local", { force: true });
      rmSync(".convex", { recursive: true, force: true });
      if (isolatedHome !== undefined)
        rmSync(isolatedHome, { recursive: true, force: true });
    }
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await runCodegenCheck();
