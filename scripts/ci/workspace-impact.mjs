#!/usr/bin/env node
// Advisory only. This module exports no scheduling or skip outputs.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createServer } from "vite";

export const harnesses = [
  "storage-workspace-preview",
  "barcode-preview",
  "barcode-scanning-preview",
];
export const runtimeModules = {
  prepare: "src/features/finishedGoods/jobScan/prepareJobTicketPhoto.ts",
  baseline: "tests/fixtures/job-ticket-jpeg-baseline.ts",
  decoder: "src/features/finishedGoods/barcodeDecoder.ts",
};
const runtimeCaller =
  "tests/e2e/workspace/job-ticket-image-compression.spec.ts";
const runtimeCallerHash =
  "a7e602ff51724ba0da05b26fdaf3da9dcf0c98637af8c33a868b643af37d82ba";
const nonImportRoots = [
  "public/",
  "messages/",
  "tests/fixtures/",
  "output/",
  "tests/e2e/support/",
  "tests/e2e/workspace/",
  ...harnesses.map((name) => `scripts/${name}/`),
];
const git = (root, args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
const sha = (value) =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function files(root, directory) {
  return readdirSync(resolve(root, directory), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(root, resolve(entry.parentPath, entry.name)).replaceAll(
        "\\",
        "/",
      ),
    );
}

export function imports(source, file) {
  const result = { literals: [], unknown: [] };
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.literals.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(ast) === "require")
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument))
        result.literals.push(argument.text);
      else {
        const key = argument
          ?.getText(ast)
          .match(/^modules\.(prepare|baseline|decoder)$/)?.[1];
        // Audit both the computed expression and the exact /@fs mapping.
        const mapping =
          key && `${key}: \`/@fs\${resolve("${runtimeModules[key]}")}\``;
        if (
          file === runtimeCaller &&
          mapping &&
          source.includes(mapping) &&
          createHash("sha256").update(source).digest("hex") ===
            runtimeCallerHash
        )
          result.literals.push(`/${runtimeModules[key]}`);
        else
          result.unknown.push(
            `computed import in ${file}: ${argument?.getText(ast) ?? "missing"}`,
          );
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "import.meta.glob"
    )
      result.unknown.push(`glob in ${file}`);
    ts.forEachChild(node, visit);
  }
  if (ast.parseDiagnostics.length)
    result.unknown.push(`parse error in ${file}`);
  visit(ast);
  return result;
}

export async function dependencyEvidence(root) {
  const dependencies = new Set(["playwright.workspace.config.ts"]);
  const unknown = [];
  const resolutions = [];
  const servers = [];
  try {
    for (const name of harnesses) {
      // Real dev-mode resolver, including each harness's ordered aliases.
      const server = await createServer({
        configFile: resolve(root, `scripts/${name}/vite.config.mjs`),
        server: { middlewareMode: true, watch: null, hmr: false, ws: false },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      servers.push(server);
      const seeds = [
        ...files(root, `scripts/${name}`),
        ...files(root, "tests/e2e/workspace"),
        ...files(root, "tests/e2e/support"),
        "playwright.workspace.config.ts",
        ...Object.values(runtimeModules),
      ];
      const visited = new Set();
      while (seeds.length) {
        const file = seeds.pop();
        if (visited.has(file)) continue;
        visited.add(file);
        dependencies.add(file);
        if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) continue;
        const parsed = imports(readFileSync(resolve(root, file), "utf8"), file);
        unknown.push(...parsed.unknown);
        for (const specifier of parsed.literals) {
          if (specifier.startsWith("node:")) continue;
          let target;
          if (
            Object.values(runtimeModules).some(
              (path) => specifier === `/${path}`,
            )
          )
            target = resolve(root, specifier.slice(1));
          else
            target = (
              await server.pluginContainer.resolveId(
                specifier,
                resolve(root, file),
              )
            )?.id;
          if (!target || target.startsWith("\0")) {
            unknown.push(`unresolved ${file}: ${specifier}`);
            continue;
          }
          if (target.includes("/node_modules/")) continue; // Frozen lockfile/toolchain changes always predict full.
          target = target.split("?")[0];
          const path = relative(root, target).replaceAll("\\", "/");
          if (path.startsWith("../") || !existsSync(target)) {
            unknown.push(`outside/missing ${file}: ${specifier}`);
            continue;
          }
          resolutions.push({ harness: name, importer: file, specifier, path });
          seeds.push(path);
        }
      }
    }
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
  return {
    dependencies: [...dependencies].sort(),
    unknown: [...new Set(unknown)].sort(),
    resolutions,
  };
}

/** @param {{event?: string | undefined, changes?: Array<{status: string, path: string}>, evidence?: {dependencies: string[], unknown: string[]}, valid?: boolean}} input */
export function classify({ event, changes = [], evidence, valid = true }) {
  const reasons = [];
  if (event !== "pull_request") reasons.push("event requires full execution");
  if (!valid) reasons.push("missing or invalid Git evidence");
  if (!evidence || evidence.unknown.length)
    reasons.push("incomplete dependency evidence");
  const changedPaths = changes.map(({ status, path }) => {
    let reason;
    if (status !== "M") reason = "new/deleted/renamed or unknown status";
    else if (
      evidence?.dependencies.includes(path) ||
      nonImportRoots.some((prefix) => path.startsWith(prefix))
    )
      reason = "workspace dependency or declared runtime input";
    // Only existing integration test implementations outside the closure are
    // negative candidates. No prose, production folder or extension exemption.
    else if (/^tests\/integration\/[^/]+\.integration\.test\.ts$/.test(path))
      reason = "integration test outside observed workspace closure";
    else reason = "unreviewed path requires full prediction";
    if (reason !== "integration test outside observed workspace closure")
      reasons.push(`${path}: ${reason}`);
    return { status, path, reason };
  });
  return {
    mode: "report-only",
    effectiveWorkspaceRun: true,
    predictedWorkspaceAffected: reasons.length > 0,
    reasons,
    changedPaths,
  };
}

export function diffEvidence(root, base, head) {
  if (!sha(base) || !sha(head)) throw new Error("invalid revision");
  for (const revision of [base, head])
    git(root, ["cat-file", "-e", `${revision}^{commit}`]);
  const fields = git(root, [
    "diff",
    "--no-ext-diff",
    "--no-renames",
    "--name-status",
    "-z",
    base,
    head,
    "--",
  ]).split("\0");
  if (fields.pop() !== "" || fields.length % 2)
    throw new Error("incomplete diff");
  const result = [];
  for (let index = 0; index < fields.length; index += 2)
    result.push({ status: fields[index], path: fields[index + 1] });
  return result;
}

/** @param {string} root
 * @param {Record<string, string | undefined>} env
 */
export async function report(root, env = process.env) {
  const start = performance.now();
  const event = env.GITHUB_EVENT_NAME ?? "unknown";
  let base = null,
    head = null,
    changes = [],
    evidence = null,
    valid = false,
    error = null;
  try {
    head = git(root, ["rev-parse", "HEAD"]).trim();
    if (event === "pull_request") {
      base = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"))
        .pull_request?.base?.sha;
      if (!sha(base)) throw new Error("invalid PR base");
      try {
        git(root, ["cat-file", "-e", `${base}^{commit}`]);
      } catch {
        git(root, ["fetch", "--no-tags", "--depth=1", "origin", base]);
      }
      changes = diffEvidence(root, base, head);
      evidence = await dependencyEvidence(root);
      valid = true;
    }
  } catch (caught) {
    error = caught.message.split("\n")[0];
  }
  return {
    version: 1,
    base,
    head,
    ...classify({ event, changes, evidence, valid }),
    error,
    dependencyEvidence: evidence,
    analysisDurationMs: Math.round(performance.now() - start),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await report(process.cwd());
  const json = JSON.stringify(result, null, 2) + "\n";
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/workspace-impact-report.json", json);
  console.log(json);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\nWorkspace impact (report only; effective run always true)\n\n\`\`\`json\n${JSON.stringify({ ...result, dependencyEvidence: undefined }, null, 2)}\n\`\`\`\n`,
    );
}
