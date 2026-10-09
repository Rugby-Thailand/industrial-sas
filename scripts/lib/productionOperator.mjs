// Shared refusal guards for the production data-repair scripts
// (`scripts/*-production.mjs`; S9 / R14 / BD-13). Every check runs before a
// Convex client exists, so a refused run sends no request. Messages name the
// failed control only; credential values are never printed.
//
// Contract (docs/operations/release-runbook.md, "Operator data repairs"):
//   node --env-file=/private/operator.env scripts/<name>-production.mjs \
//     --mode preflight|apply|verify --directory /private/run \
//     [--backup /private/run/preflight.json --backup-sha256 <hex>] \
//     [--confirm-deployment greedy-cardinal-537]   # apply only
//
// * The admin credential is read only from `CONVEX_ADMIN_KEY`. The deploy-key
//   slot `CONVEX_DEPLOY_KEY` must be absent (even alongside an admin key): it
//   belongs to the Vercel build, and sharing one name invites pasting a broad
//   admin key into CI or Vercel.
// * The key must be a deployment key for exactly `prod:greedy-cardinal-537`,
//   and `CONVEX_URL` must be that deployment's cloud URL.
// * Both values must come from the single `--env-file`, which must be private
//   (owner-only permissions, owned by the operator, not a symlink) and kept
//   outside the repository or in an ignored private directory. A shell value
//   that overrides the file is refused.
// * Artifacts live in an existing owner-only (0700) directory outside version
//   control. A backup is read only when it is a private 0600 file whose SHA-256
//   matches the hash the reviewed preflight printed.
// * Mutation (`--mode apply`) also requires `--confirm-deployment` naming the
//   production deployment. Preflight remains the read-only default. Scripts
//   never retry a mutation; an uncertain outcome is investigated with `verify`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";

import { classifyConvexDeployKey } from "../release/lib/credential-shapes.mjs";

export const PRODUCTION_OPERATOR_TARGET = Object.freeze({
  deploymentName: "greedy-cardinal-537",
  deploymentUrl: "https://greedy-cardinal-537.convex.cloud",
  keyClass: "prod",
});

export const OPERATOR_MODES = Object.freeze(["preflight", "apply", "verify"]);

/** Ignored repository directories for private operator material (.gitignore). */
export const PRIVATE_REPOSITORY_DIRECTORIES = Object.freeze([
  "data/import-staging",
  "data/private",
]);

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// Selectors that indicate a mixed or non-production credential context.
const FORBIDDEN_SELECTORS = Object.freeze([
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
]);

const SHA256 = /^[0-9a-f]{64}$/;

const refuse = (message) => assert.fail(message);

/** The single `--env-file` path in Node's execArgv, resolved. */
export function envFileFromExecArgv(execArgv) {
  const paths = [];
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index];
    if (argument.startsWith("--env-file-if-exists")) {
      refuse("Use --env-file, not --env-file-if-exists, for operator runs");
    }
    if (argument === "--env-file") paths.push(execArgv[index + 1]);
    else if (argument.startsWith("--env-file=")) {
      paths.push(argument.slice("--env-file=".length));
    }
  }
  if (paths.length !== 1 || !paths[0]) {
    refuse(
      "Run with exactly one node --env-file=<private operator env file> argument",
    );
  }
  return resolve(paths[0]);
}

function isWithin(child, parent) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** Refuse a repository path unless it is inside an ignored private directory. */
export function assertPrivateLocation(path, label, root = REPOSITORY_ROOT) {
  const real = realpathSync(path);
  const realRoot = realpathSync(root);
  if (!isWithin(real, realRoot)) return real;
  const allowed = PRIVATE_REPOSITORY_DIRECTORIES.some((directory) =>
    isWithin(real, resolve(realRoot, directory)),
  );
  if (!allowed) {
    refuse(
      `${label} must be outside the repository or under ${PRIVATE_REPOSITORY_DIRECTORIES.join(" or ")}`,
    );
  }
  return real;
}

function ownedByOperator(stats) {
  return typeof process.getuid !== "function" || stats.uid === process.getuid();
}

/** Regular, non-symlink, operator-owned file with no group/other access. */
export function assertPrivateFile(path, label, { exactMode } = {}) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    refuse(`${label} does not exist`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    refuse(`${label} must be a regular file, not a link`);
  }
  const mode = stats.mode & 0o777;
  if (exactMode === undefined ? (mode & 0o077) !== 0 : mode !== exactMode) {
    refuse(
      `${label} must be ${exactMode === undefined ? "owner-only (for example 0600)" : `mode ${exactMode.toString(8).padStart(4, "0")}`}`,
    );
  }
  if (!ownedByOperator(stats)) refuse(`${label} must be owned by the operator`);
}

/** Existing operator-owned 0700 directory, not a symlink. */
export function assertPrivateDirectory(path, label) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    refuse(`${label} must name an existing private directory`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    refuse(`${label} must be a directory, not a link`);
  }
  if ((stats.mode & 0o777) !== 0o700) refuse(`${label} must be mode 0700`);
  if (!ownedByOperator(stats)) refuse(`${label} must be owned by the operator`);
}

/**
 * Validate the production admin credential context. `fileValues` are the
 * variables parsed from the env file; `env` is the process environment.
 */
export function validateOperatorCredentials(
  env,
  fileValues,
  target = PRODUCTION_OPERATOR_TARGET,
) {
  for (const name of FORBIDDEN_SELECTORS) {
    if (Object.hasOwn(env, name) || Object.hasOwn(fileValues, name)) {
      refuse(
        name === "CONVEX_DEPLOY_KEY"
          ? "CONVEX_DEPLOY_KEY must be unset: operator scripts use only CONVEX_ADMIN_KEY, and the deploy-key slot is reserved for the Vercel build"
          : `${name} must be unset for production operator runs`,
      );
    }
  }
  for (const name of ["CONVEX_URL", "CONVEX_ADMIN_KEY"]) {
    if (!Object.hasOwn(fileValues, name)) {
      refuse(`${name} must be defined in the --env-file`);
    }
    if (env[name] !== fileValues[name]) {
      refuse(`${name} in the shell environment overrides the --env-file`);
    }
  }
  if (env.CONVEX_URL !== target.deploymentUrl) {
    refuse("CONVEX_URL is not the reviewed production deployment");
  }
  const key = classifyConvexDeployKey(env.CONVEX_ADMIN_KEY);
  const prefix = `${target.keyClass}:${target.deploymentName}|`;
  if (
    key.kind !== "deployment" ||
    key.keyClass !== target.keyClass ||
    key.deployment !== target.deploymentName ||
    !env.CONVEX_ADMIN_KEY.startsWith(prefix) ||
    env.CONVEX_ADMIN_KEY.trim() !== env.CONVEX_ADMIN_KEY
  ) {
    refuse(
      `CONVEX_ADMIN_KEY is not a ${target.keyClass} deployment credential for ${target.deploymentName}`,
    );
  }
  return { url: env.CONVEX_URL, adminKey: env.CONVEX_ADMIN_KEY };
}

export function parseOperatorArgs(argv) {
  let values;
  let tokens;
  try {
    ({ values, tokens } = parseArgs({
      args: argv,
      options: {
        mode: { type: "string", default: "preflight" },
        directory: { type: "string" },
        backup: { type: "string" },
        "backup-sha256": { type: "string" },
        "confirm-deployment": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
      tokens: true,
    }));
  } catch {
    refuse("Unknown or malformed operator argument");
  }
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name))
      refuse(`Duplicate operator option --${token.name}`);
    seen.add(token.name);
  }
  if (!OPERATOR_MODES.includes(values.mode)) refuse("Unknown mode");
  return values;
}

/**
 * Run every local control in order and return the validated run context.
 * `backupModes` lists the modes that read `--backup`.
 *
 * @param {{
 *   argv?: string[],
 *   env?: Readonly<Record<string, string | undefined>>,
 *   execArgv?: string[],
 *   backupModes?: string[],
 *   target?: typeof PRODUCTION_OPERATOR_TARGET,
 *   repositoryRoot?: string,
 * }} [options]
 */
export function prepareOperatorRun({
  argv = process.argv.slice(2),
  env = process.env,
  execArgv = process.execArgv,
  backupModes = ["apply", "verify"],
  target = PRODUCTION_OPERATOR_TARGET,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  const values = parseOperatorArgs(argv);

  const envFile = envFileFromExecArgv(execArgv);
  assertPrivateFile(envFile, "--env-file");
  assertPrivateLocation(envFile, "--env-file", repositoryRoot);
  let fileValues;
  try {
    fileValues = parseEnv(readFileSync(envFile, "utf8"));
  } catch {
    refuse("--env-file could not be read");
  }
  const credentials = validateOperatorCredentials(env, fileValues, target);

  if (!values.directory) {
    refuse("--directory must name an existing private directory");
  }
  const requestedDirectory = resolve(values.directory);
  assertPrivateDirectory(requestedDirectory, "Artifact directory");
  const directory = assertPrivateLocation(
    requestedDirectory,
    "Artifact directory",
    repositoryRoot,
  );

  let backup;
  if (backupModes.includes(values.mode)) {
    if (!values.backup) refuse("--backup is required");
    if (!SHA256.test(values["backup-sha256"] ?? "")) {
      refuse(
        "--backup-sha256 must be the 64-character hash printed by the reviewed preflight",
      );
    }
    const path = resolve(values.backup);
    assertPrivateFile(path, "Backup", { exactMode: 0o600 });
    assertPrivateLocation(path, "Backup", repositoryRoot);
    const text = readFileSync(path, "utf8");
    const sha256 = createHash("sha256").update(text).digest("hex");
    if (sha256 !== values["backup-sha256"]) {
      refuse("Backup SHA-256 does not match --backup-sha256");
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      refuse("Backup is not valid JSON");
    }
    if (data?.deployment !== target.deploymentUrl) {
      refuse("Backup was not captured from the reviewed production deployment");
    }
    backup = { path, sha256, data };
  } else if (values.backup || values["backup-sha256"]) {
    refuse(`--backup is not used in ${values.mode} mode`);
  }

  if (values.mode === "apply") {
    if (values["confirm-deployment"] !== target.deploymentName) {
      refuse(
        `--mode apply requires --confirm-deployment ${target.deploymentName}`,
      );
    }
  } else if (values["confirm-deployment"] !== undefined) {
    refuse("--confirm-deployment is accepted only with --mode apply");
  }

  return Object.freeze({
    mode: values.mode,
    directory,
    backup,
    url: credentials.url,
    adminKey: credentials.adminKey,
  });
}
