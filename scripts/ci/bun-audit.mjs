#!/usr/bin/env node
// T03 opt-in Bun audit adapter. pnpm's audit remains the enforced gate.
//
//   node scripts/ci/bun-audit.mjs --scope=app|release --bun-dir=<dir> \
//     --mode=exceptions|runtime|summary [--bun=<path>] [--replay=<stdout>:<exit>]
//
// `bun audit --json` prints the registry's raw bulk response: package →
// advisories, with no installed versions or paths, and exit 1 means either
// "vulnerabilities" or "request failed". This adapter validates the raw
// response and child status, then rebuilds a pnpm-shaped report from the
// candidate bun.lock graph with the installed vulnerable versions and EVERY
// simple root→package path. The unchanged pnpm policy functions then decide:
//   exceptions  auditProblems(report, dependency-exceptions.json, scope)
//   runtime     production-reachable only, auditProblems with NO exceptions
//   summary     auditSummary (all severities, informative)
// Anything unexpected fails closed.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { auditProblems } from "./audit-dependencies.mjs";
import {
  allSimplePaths,
  graphProblems,
  loadBunScope,
  rootPinProblems,
} from "./lockfile-graph.mjs";
import { parseUniqueJson } from "./json-input.mjs";
import { auditSummary } from "./report-lib.mjs";
import { satisfies } from "./semver-range.mjs";

export const SEVERITIES = Object.freeze([
  "info",
  "low",
  "moderate",
  "high",
  "critical",
]);
const GHSA_URL =
  /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/;
export const AUDIT_TIMEOUT_MS = 120_000;
export const AUDIT_OUTPUT_LIMIT = 8 * 1024 * 1024;

/** Fail-closed interpretation of one `bun audit --json` child result. */
export function rawAuditProblems({
  status,
  signal,
  timedOut,
  outputExceeded,
  spawnError,
  cleanupError,
  stdout,
  stderr,
}) {
  const problems = childProblems({
    status,
    signal,
    timedOut,
    outputExceeded,
    spawnError,
    stdout,
    stderr,
  });
  // A child whose owned temporary HOME could not be removed is never
  // certified as a clean run, whatever its report says.
  return cleanupError
    ? [`bun audit isolated HOME cleanup failed: ${cleanupError}`, ...problems]
    : problems;
}

function childProblems({
  status,
  signal,
  timedOut,
  outputExceeded,
  spawnError,
  stdout,
  stderr,
}) {
  if (spawnError) return [`bun audit could not start: ${spawnError}`];
  if (
    outputExceeded ||
    Buffer.byteLength(stdout ?? "") > AUDIT_OUTPUT_LIMIT ||
    Buffer.byteLength(stderr ?? "") > AUDIT_OUTPUT_LIMIT
  )
    return ["bun audit output exceeded the supported bound"];
  if (timedOut) return ["bun audit timed out"];
  if (signal) return [`bun audit terminated by ${signal}`];
  if (![0, 1].includes(status)) return [`bun audit exited ${status}`];
  if (/audit request failed|error:/i.test(stderr ?? ""))
    return ["bun audit reported a registry or request failure"];
  if (typeof stdout !== "string" || stdout.trim() === "")
    return ["bun audit printed no report"];
  let report;
  try {
    report = parseUniqueJson(stdout);
  } catch {
    return ["bun audit output is not JSON"];
  }
  if (report === null || typeof report !== "object" || Array.isArray(report))
    return ["bun audit report is not an object"];
  if ("error" in report || "message" in report)
    return ["bun audit report is a registry error"];
  const problems = [];
  const ids = new Set();
  const urls = new Set();
  for (const [name, advisories] of Object.entries(report)) {
    if (!Array.isArray(advisories) || !advisories.length) {
      problems.push(`${name}: advisory list is empty or malformed`);
      continue;
    }
    for (const advisory of advisories) {
      if (
        !advisory ||
        typeof advisory !== "object" ||
        !Number.isSafeInteger(advisory.id) ||
        advisory.id <= 0 ||
        !GHSA_URL.test(advisory.url ?? "") ||
        typeof advisory.title !== "string" ||
        typeof advisory.vulnerable_versions !== "string" ||
        !advisory.vulnerable_versions.trim()
      )
        problems.push(`${name}: malformed advisory`);
      else if (!SEVERITIES.includes(advisory.severity))
        problems.push(`${name}: unknown severity ${String(advisory.severity)}`);
      else {
        if (ids.has(advisory.id) || urls.has(advisory.url))
          problems.push(`${name}: duplicate advisory identity`);
        ids.add(advisory.id);
        urls.add(advisory.url);
      }
    }
  }
  const empty = Object.keys(report).length === 0;
  // Without --audit-level, Bun exits 1 exactly when advisories exist.
  if (status === 0 && !empty)
    problems.push("bun audit exited 0 with advisories");
  if (status === 1 && empty)
    problems.push("bun audit exited 1 with an empty report (request failure?)");
  return problems.length ? problems : [];
}

/**
 * Packages the audit cannot cover: a non-default registry tarball in the
 * lock, or a registry/scope override in .npmrc/bunfig.toml (Bun silently
 * skips registries without an advisory endpoint).
 */
export function coverageProblems(graph, { npmrc = "", bunfig = "" } = {}) {
  const problems = [];
  for (const node of graph.nodes.values())
    if (node.registry !== "")
      problems.push(
        `${node.key}: non-default registry ${node.registry}; not audited`,
      );
  for (const line of npmrc.split("\n"))
    if (/^\s*(@[^:]+:)?registry\s*=/.test(line))
      problems.push(".npmrc: registry override; audit coverage unproven");
  // Reject quoted and inline TOML forms too. A conservative rejection is
  // preferable to declaring coverage for a configuration we cannot prove.
  if (/\b(?:registry|scopes)\b/.test(bunfig))
    problems.push(
      "bunfig.toml: registry/scope override; audit coverage unproven",
    );
  return problems;
}

/**
 * pnpm-shaped report rebuilt from a validated raw Bun report and the
 * candidate lock graph. `production` keeps only production chains. Throws
 * when an advisory cannot be tied to an installed version and path.
 */
export function normalizeBunAudit(raw, graph, { production = false } = {}) {
  const advisories = Object.create(null);
  const vulnerabilities = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const [name, list] of Object.entries(raw)) {
    const nodes = [...graph.nodes.values()].filter(
      (node) => node.name === name,
    );
    if (!nodes.length)
      throw new Error(`${name}: advisory for a package absent from the lock`);
    const allPaths = allSimplePaths(graph, (node) => node.name === name);
    for (const advisory of list) {
      const findingsFor = (paths) => {
        const findings = [];
        for (const version of [
          ...new Set(nodes.map((node) => node.version)),
        ].sort()) {
          if (!satisfies(version, advisory.vulnerable_versions)) continue;
          const versionPaths = paths
            .filter((entry) => entry.versions.includes(version))
            .map((entry) => entry.path);
          if (versionPaths.length)
            findings.push({ version, paths: versionPaths });
        }
        return findings;
      };
      // Every advisory must match an installed version on some path; a
      // registry advisory that matches nothing is a contradiction.
      if (!findingsFor(allPaths).length)
        throw new Error(
          `${name}: ${advisory.url} matches no installed version/path`,
        );
      // Runtime scope keeps only production chains (pnpm audit --prod).
      const findings = findingsFor(
        production ? allPaths.filter((entry) => entry.production) : allPaths,
      );
      if (!findings.length) continue;
      const ghsa = GHSA_URL.exec(advisory.url)[1];
      advisories[String(advisory.id)] = {
        id: advisory.id,
        github_advisory_id: ghsa,
        module_name: name,
        severity: advisory.severity,
        vulnerable_versions: advisory.vulnerable_versions,
        title: advisory.title,
        url: advisory.url,
        findings,
      };
      vulnerabilities[advisory.severity] += 1;
    }
  }
  return { advisories, metadata: { vulnerabilities } };
}

/** Decision for one mode; returns `{ problems, report, summary? }`. */
export function decide(
  mode,
  { child, graph, coverage, exceptions, scope, now = Date.now() },
) {
  if (!["exceptions", "runtime", "summary"].includes(mode))
    return { problems: ["Unknown Bun audit decision mode"] };
  let problems;
  try {
    problems = [
      ...graphProblems(graph),
      ...coverage,
      ...rawAuditProblems(child),
    ];
  } catch {
    return { problems: ["Bun audit graph evidence is malformed"] };
  }
  if (problems.length) return { problems };
  let report;
  try {
    report = normalizeBunAudit(parseUniqueJson(child.stdout), graph, {
      production: mode === "runtime",
    });
  } catch (error) {
    return { problems: [error.message] };
  }
  if (mode === "summary") {
    try {
      return { problems: [], report, summary: auditSummary(report) };
    } catch (error) {
      return { problems: [error.message] };
    }
  }
  const policy = mode === "runtime" ? [] : exceptions;
  return { problems: auditProblems(report, policy, scope, now), report };
}

export function runBunAudit(bun, directory, production) {
  // Host error text can name the temporary path; report only a plain errno code.
  const hostFailure = (error) =>
    typeof error?.code === "string" && /^E[A-Z0-9]+$/.test(error.code)
      ? error.code
      : "unknown host error";
  return new Promise((done) => {
    // A creation failure owns nothing; the executor throw rejects (fail closed).
    const auditHome = mkdtempSync(join(tmpdir(), "t03-bun-audit-home-"));
    // Every settlement below removes the owned HOME exactly once and reports,
    // rather than throws, a removal failure so the result is always refused.
    const removeHome = () => {
      try {
        rmSync(auditHome, { recursive: true, force: true });
        return null;
      } catch (error) {
        return hostFailure(error);
      }
    };
    const args = [
      "--no-env-file",
      "audit",
      "--json",
      ...(production ? ["--prod"] : []),
    ];
    let child;
    try {
      child = spawn(bun, args, {
        cwd: directory,
        // Isolated global config and no inherited credentials. Project registry
        // configuration is separately rejected by coverageProblems.
        env: {
          HOME: auditHome,
          XDG_CONFIG_HOME: auditHome,
          PATH: process.env.PATH ?? "",
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      // Synchronous host refusal (for example EAGAIN): no child exists, so
      // nothing else will settle this promise or remove the HOME.
      done({
        status: null,
        signal: null,
        timedOut: false,
        outputExceeded: false,
        spawnError: `synchronous spawn failure (${hostFailure(error)})`,
        cleanupError: removeHome(),
        stdout: "",
        stderr: "",
      });
      return;
    }
    // Raw byte chunks per stream, decoded once at close so a UTF-8 sequence
    // split across chunks survives; the running count bounds raw bytes.
    const output = {
      stdout: { chunks: [], bytes: 0 },
      stderr: { chunks: [], bytes: 0 },
    };
    let timedOut = false;
    let spawnError = null;
    let outputExceeded = false;
    const append = (stream, chunk) => {
      if (outputExceeded) return;
      const buffered = output[stream];
      if (buffered.bytes + chunk.length > AUDIT_OUTPUT_LIMIT) {
        outputExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      buffered.chunks.push(chunk);
      buffered.bytes += chunk.length;
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, AUDIT_TIMEOUT_MS);
    child.on("error", (error) => (spawnError = error.message));
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      const cleanupError = removeHome();
      done({
        status,
        signal,
        timedOut,
        outputExceeded,
        spawnError,
        cleanupError,
        stdout: Buffer.concat(output.stdout.chunks).toString("utf8"),
        stderr: Buffer.concat(output.stderr.chunks).toString("utf8"),
      });
    });
  });
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const match = /^--([a-z-]+)=(.+)$/.exec(arg);
      return match ? [match[1], match[2]] : [arg, ""];
    }),
  );
  const allowed = ["scope", "bun-dir", "mode", "bun", "replay"];
  if (
    !["app", "release"].includes(args.scope) ||
    !["exceptions", "runtime", "summary"].includes(args.mode) ||
    !args["bun-dir"] ||
    Object.keys(args).some((key) => !allowed.includes(key))
  ) {
    console.error(
      "Usage: bun-audit.mjs --scope=app|release --bun-dir=<dir> --mode=exceptions|runtime|summary [--bun=<path>] [--replay=<stdout>:<exit>]",
    );
    process.exit(2);
  }
  try {
    const directory = resolve(args["bun-dir"]);
    const { graph, manifest } = loadBunScope(args.scope, directory);
    const structuralProblems = [
      ...graphProblems(graph),
      ...rootPinProblems(graph, manifest),
    ];
    if (structuralProblems.length)
      throw new Error(structuralProblems.join("; "));
    const read = (file) =>
      existsSync(join(directory, file))
        ? readFileSync(join(directory, file), "utf8")
        : "";
    const coverage = coverageProblems(graph, {
      npmrc: read(".npmrc"),
      bunfig: read("bunfig.toml"),
    });
    let child;
    if (args.replay) {
      const [file, exit] = args.replay.split(/:(?=\d+$)/);
      child = {
        status: Number(exit),
        signal: null,
        timedOut: false,
        spawnError: null,
        stdout: readFileSync(file, "utf8"),
        stderr: "",
      };
    } else
      child = await runBunAudit(
        args.bun ?? "bun",
        directory,
        args.mode === "runtime",
      );
    const exceptions = parseUniqueJson(
      readFileSync(join(root, "scripts/ci/dependency-exceptions.json"), "utf8"),
    ).exceptions;
    const result = decide(args.mode, {
      child,
      graph,
      coverage,
      exceptions,
      scope: args.scope,
    });
    for (const problem of result.problems) console.error(problem);
    if (result.summary) console.log(JSON.stringify(result.summary.counts));
    if (result.report)
      for (const advisory of Object.values(result.report.advisories))
        for (const finding of advisory.findings)
          console.log(
            `${advisory.severity} ${advisory.github_advisory_id} ${advisory.module_name}@${finding.version}: ${finding.paths.length} path(s)`,
          );
    console.log(
      result.problems.length
        ? `Bun audit candidate FAILED (${args.scope}, ${args.mode})`
        : `Bun audit candidate passed (${args.scope}, ${args.mode})`,
    );
    process.exitCode = result.problems.length ? 1 : 0;
  } catch (error) {
    console.error(
      `Bun audit candidate failed closed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
