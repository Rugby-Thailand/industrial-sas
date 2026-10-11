#!/usr/bin/env node
// T03 inert lifecycle-trust probe (opt-in, never part of CI or `pnpm test`).
//
//   node tests/fixtures/bun-lifecycle/marker-probe.mjs --bun=<path to bun 1.4.3>
//
// Serves two synthetic packages from a loopback-only registry and installs
// them with Bun into fresh temporary projects. Each package's only lifecycle
// script is `echo <event> > t03-marker` (plus the value of one synthetic,
// non-secret variable). Nothing is fetched from the network and no real
// dependency script can run: the registry serves only these two tarballs.
//
// One package reuses a name from Bun's default trusted list (`esbuild`) at a
// fake prerelease version, so the probe shows what omitting
// `trustedDependencies` would allow. The other name is not on that list.
// A synthetic `.env` (created here, never a real one) checks whether Bun's
// automatic dotenv loading reaches lifecycle scripts, with and without
// `env = false` in bunfig.toml and the `--no-env-file` flag.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TRUSTED_NAME = "esbuild";
const PLAIN_NAME = "t03-untrusted-marker";
const VERSION = "0.0.0-t03.1";
const MARKER_VARIABLE = "T03_DOTENV_MARKER";

/** One inert package: a manifest whose postinstall writes a marker file. */
function packageFiles(name) {
  return {
    "package.json": JSON.stringify(
      {
        name,
        version: VERSION,
        scripts: {
          postinstall: `echo "postinstall:\${${MARKER_VARIABLE}:-unset}" > t03-marker`,
        },
      },
      null,
      2,
    ),
  };
}

function buildTarball(work, name) {
  const root = join(work, `src-${name}`, "package");
  mkdirSync(root, { recursive: true });
  for (const [file, text] of Object.entries(packageFiles(name)))
    writeFileSync(join(root, file), text);
  const tarball = join(work, `${name}-${VERSION}.tgz`);
  const result = spawnSync(
    "tar",
    ["-czf", tarball, "-C", join(work, `src-${name}`), "package"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`);
  const bytes = readFileSync(tarball);
  return {
    bytes,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    shasum: createHash("sha1").update(bytes).digest("hex"),
    manifest: JSON.parse(packageFiles(name)["package.json"]),
  };
}

/**
 * Request handler serving exactly four paths: each synthetic package's
 * manifest at `/<name>` and its tarball at npm's canonical layout
 * `/<name>/-/<name>-<version>.tgz`. Bun grants its default trust only when
 * the locked tarball URL is canonical for the configured registry
 * (lockfile.rs `has_trusted_dependency`). The raw request target is looked up
 * verbatim in a Map (no decoding, no pattern matching, no plain-object keys),
 * so unknown, prototype-named, percent-encoded, malformed or otherwise
 * noncanonical requests get 404. Exported only so tests can exercise it
 * without a socket or an install.
 */
export function createRegistryHandler(packages, port) {
  const routes = new Map();
  for (const name of [DEFAULT_TRUSTED_NAME, PLAIN_NAME]) {
    if (!Object.hasOwn(packages, name))
      throw new Error(`missing synthetic package: ${name}`);
    const entry = packages[name];
    const tarballPath = `/${name}/-/${name}-${VERSION}.tgz`;
    routes.set(`/${name}`, {
      type: "application/json",
      body: JSON.stringify({
        name,
        "dist-tags": { latest: VERSION },
        versions: {
          [VERSION]: {
            ...entry.manifest,
            dist: {
              tarball: `http://127.0.0.1:${port}${tarballPath}`,
              integrity: entry.integrity,
              shasum: entry.shasum,
            },
          },
        },
      }),
    });
    routes.set(tarballPath, {
      type: "application/octet-stream",
      body: entry.bytes,
    });
  }
  return (request, response) => {
    const route = routes.get(request.url);
    if (!route) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    response.writeHead(200, { "content-type": route.type });
    response.end(route.body);
  };
}

function startRegistry(packages) {
  const server = createServer();
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      server.on(
        "request",
        createRegistryHandler(packages, server.address().port),
      );
      resolve(server);
    }),
  );
}

/**
 * Runs a child asynchronously so this process's loopback registry keeps
 * answering Bun's requests. A bounded deadline kills the child (SIGKILL);
 * every exit code, signal, spawn error and timeout is recorded.
 */
function run(command, args, options, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError = null;
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => (spawnError = error.message));
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, timedOut, spawnError, stdout, stderr });
    });
  });
}

async function runCase(bun, base, port, testCase) {
  const project = join(base, testCase.id);
  mkdirSync(join(project, "home"), { recursive: true });
  const manifest = {
    name: `t03-${testCase.id}`,
    private: true,
    dependencies: {
      [DEFAULT_TRUSTED_NAME]: VERSION,
      [PLAIN_NAME]: VERSION,
    },
  };
  if (testCase.trustedDependencies !== undefined)
    manifest.trustedDependencies = testCase.trustedDependencies;
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  const bunfig = [
    ...(testCase.disableDotenv ? ["env = false", ""] : []),
    "[install]",
    'linker = "isolated"',
    "exact = true",
    `registry = "http://127.0.0.1:${port}/"`,
    ...(testCase.ignoreScripts ? ["ignoreScripts = true"] : []),
    "",
    "[install.cache]",
    `dir = "${join(project, "cache")}"`,
    "",
  ].join("\n");
  writeFileSync(join(project, "bunfig.toml"), bunfig);
  // Synthetic, non-secret value created by this probe only.
  writeFileSync(join(project, ".env"), `${MARKER_VARIABLE}=from-dotenv\n`);
  const env = {
    HOME: join(project, "home"),
    PATH: "/usr/bin:/bin",
    TMPDIR: join(project, "home"),
    NO_COLOR: "1",
  };
  const options = { cwd: project, env };
  const install = await run(
    bun,
    testCase.installArgs ?? ["install", "--no-progress"],
    options,
  );
  const untrusted = await run(bun, ["pm", "untrusted"], options);
  const markerOf = (name) => {
    const file = join(
      project,
      "node_modules",
      ".bun",
      `${name}@${VERSION}`,
      "node_modules",
      name,
      "t03-marker",
    );
    return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
  };
  const runtimeDotenv = await run(
    bun,
    ["-e", `console.log(process.env.${MARKER_VARIABLE} ?? "unset")`],
    options,
    30_000,
  );
  const receipt = (result) => ({
    exit: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    spawnError: result.spawnError,
  });
  return {
    id: testCase.id,
    trustedDependencies: testCase.trustedDependencies ?? "(omitted)",
    disableDotenv: Boolean(testCase.disableDotenv),
    ignoreScripts: Boolean(testCase.ignoreScripts),
    installArgs: testCase.installArgs ?? ["install", "--no-progress"],
    install: { ...receipt(install), stderr: install.stderr.trim() },
    markers: {
      [DEFAULT_TRUSTED_NAME]: markerOf(DEFAULT_TRUSTED_NAME),
      [PLAIN_NAME]: markerOf(PLAIN_NAME),
    },
    untrustedListed: [DEFAULT_TRUSTED_NAME, PLAIN_NAME].filter((name) =>
      new RegExp(`(^|\\s|\\./node_modules/)${name}(@|\\s|$)`, "m").test(
        untrusted.stdout,
      ),
    ),
    untrusted: { ...receipt(untrusted), stdout: untrusted.stdout.trim() },
    runtimeDotenv: {
      ...receipt(runtimeDotenv),
      value: runtimeDotenv.stdout.trim(),
    },
  };
}

const CASES = Object.freeze([
  { id: "omitted", trustedDependencies: undefined, disableDotenv: true },
  { id: "explicit-empty", trustedDependencies: [], disableDotenv: true },
  {
    id: "explicit-default-name",
    trustedDependencies: [DEFAULT_TRUSTED_NAME],
    disableDotenv: true,
  },
  {
    id: "explicit-plain-name",
    trustedDependencies: [PLAIN_NAME],
    disableDotenv: true,
  },
  {
    id: "explicit-default-name-dotenv-enabled",
    trustedDependencies: [DEFAULT_TRUSTED_NAME],
    disableDotenv: false,
  },
  {
    id: "explicit-default-name-ignore-scripts",
    trustedDependencies: [DEFAULT_TRUSTED_NAME],
    disableDotenv: true,
    ignoreScripts: true,
  },
  {
    id: "explicit-default-name-no-env-file-global-flag",
    trustedDependencies: [DEFAULT_TRUSTED_NAME],
    disableDotenv: true,
    installArgs: ["--no-env-file", "install", "--no-progress"],
  },
  {
    id: "explicit-default-name-no-env-file-install-flag",
    trustedDependencies: [DEFAULT_TRUSTED_NAME],
    disableDotenv: true,
    installArgs: ["install", "--no-env-file", "--no-progress"],
  },
]);

async function main() {
  const bunArg = process.argv.find((arg) => arg.startsWith("--bun="));
  if (!bunArg || process.argv.length !== 3) {
    console.error("Usage: marker-probe.mjs --bun=<path to bun>");
    process.exit(2);
  }
  const bun = bunArg.slice("--bun=".length);
  const base = mkdtempSync(join(tmpdir(), "t03-marker-probe-"));
  const server = await startRegistry({
    [DEFAULT_TRUSTED_NAME]: buildTarball(base, DEFAULT_TRUSTED_NAME),
    [PLAIN_NAME]: buildTarball(base, PLAIN_NAME),
  });
  try {
    const { port } = server.address();
    const version = await run(
      bun,
      ["--revision"],
      { cwd: base, env: { HOME: base, PATH: "/usr/bin:/bin" } },
      30_000,
    );
    const results = [];
    for (const testCase of CASES)
      results.push(await runCase(bun, base, port, testCase));
    console.log(
      JSON.stringify(
        {
          bun: version.stdout.trim(),
          platform: `${process.platform}-${process.arch}`,
          version: VERSION,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    server.close();
    rmSync(base, { recursive: true, force: true });
  }
}

// Run only as the CLI entry point, so importing createRegistryHandler in a
// test never builds tarballs, starts a registry or spawns Bun.
if (
  process.argv[1] !== undefined &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
