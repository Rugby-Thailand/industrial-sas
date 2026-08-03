/**
 * CI configuration guard.
 *
 * GitHub validates workflow YAML only once it is pushed, and it never has an
 * opinion about supply-chain hygiene. This script checks the rules we actually
 * care about, locally and in CI, using nothing but the Node standard library —
 * a linter for the pipeline would otherwise be an unpinned dependency of the
 * thing it lints.
 *
 * Enforced:
 *   1. Every non-local `uses:` is pinned to a full 40-character commit SHA and
 *      carries a `# vX.Y.Z` comment, so a human can read the version and a tag
 *      cannot be moved under us.
 *   2. No job or workflow grants a write permission, and no `write-all`.
 *   3. No `${{ secrets.* }}` reference: the pipeline must stay credential-free.
 *   4. Every workflow declares top-level `on:`, `permissions:`, and
 *      `concurrency:`.
 *   5. Any literal `pnpm@<version>` in CI matches package.json
 *      `packageManager`, and that field is an exact pin.
 *
 * Run with `pnpm verify:workflows`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const githubDir = join(repoRoot, ".github");
const workflowsDir = join(githubDir, "workflows");

/** `owner/repo@<40 hex>` or `owner/repo/sub/path@<40 hex>`. */
const PINNED_USES = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/;
/** A readable version tag, e.g. `# v7.0.1` or `# v6`. */
const VERSION_COMMENT = /^v\d+(?:\.\d+)*(?:[-+.\w]*)$/;
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(?<ref>\S+)\s*(?<comment>#.*)?$/;
const WRITE_PERMISSION = /^\s+[a-z-]+:\s*write\s*$/;
const WRITE_ALL = /permissions:\s*write-all/;
const SECRET_REFERENCE = /\$\{\{\s*secrets\./;
const PNPM_LITERAL = /pnpm@(\d+\.\d+\.\d+)/;
const EXACT_PACKAGE_MANAGER = /^pnpm@\d+\.\d+\.\d+$/;

/** @type {{ file: string; line: number | null; message: string }[]} */
const problems = [];

/**
 * @param {string} file
 * @param {number | null} line
 * @param {string} message
 */
function fail(file, line, message) {
  problems.push({ file, line, message });
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function yamlFilesIn(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...yamlFilesIn(full));
    } else if (/\.ya?ml$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found.sort();
}

/**
 * @param {string} absolutePath
 * @param {string} packageManager
 */
function checkYamlFile(absolutePath, packageManager) {
  const file = relative(repoRoot, absolutePath);
  const source = readFileSync(absolutePath, "utf8");
  const lines = source.split("\n");
  const isWorkflow = absolutePath.startsWith(workflowsDir);

  lines.forEach((text, index) => {
    const lineNumber = index + 1;
    const uses = USES_LINE.exec(text);
    if (uses?.groups) {
      const ref = uses.groups["ref"] ?? "";
      const comment = (uses.groups["comment"] ?? "")
        .replace(/^#\s*/, "")
        .trim();
      // Local composite actions are versioned by this commit, so a SHA would be
      // circular; everything else must be immutable.
      if (!ref.startsWith("./")) {
        if (!PINNED_USES.test(ref)) {
          fail(
            file,
            lineNumber,
            `\`uses: ${ref}\` is not pinned to a full 40-character commit SHA.`,
          );
        }
        if (!VERSION_COMMENT.test(comment)) {
          fail(
            file,
            lineNumber,
            `\`uses: ${ref}\` needs a trailing version comment, e.g. \`# v1.2.3\`.`,
          );
        }
      }
    }

    if (WRITE_PERMISSION.test(text) || WRITE_ALL.test(text)) {
      fail(
        file,
        lineNumber,
        `write permission granted (\`${text.trim()}\`); CI is read-only.`,
      );
    }

    if (SECRET_REFERENCE.test(text)) {
      fail(
        file,
        lineNumber,
        "references `secrets.*`; the pipeline must stay credential-free.",
      );
    }

    const pnpmLiteral = PNPM_LITERAL.exec(text);
    if (pnpmLiteral && pnpmLiteral[1] !== packageManager) {
      fail(
        file,
        lineNumber,
        `pins pnpm@${pnpmLiteral[1]}, but package.json packageManager is pnpm@${packageManager}.`,
      );
    }
  });

  if (isWorkflow) {
    for (const key of ["on", "permissions", "concurrency"]) {
      if (!new RegExp(`^${key}:`, "m").test(source)) {
        fail(file, null, `missing top-level \`${key}:\`.`);
      }
    }
  }
}

const packageJsonPath = join(repoRoot, "package.json");
/** @type {{ packageManager?: string }} */
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const packageManagerField = packageJson.packageManager ?? "";
if (!EXACT_PACKAGE_MANAGER.test(packageManagerField)) {
  fail(
    "package.json",
    null,
    `packageManager must be an exact pin like \`pnpm@10.33.2\`, found \`${packageManagerField}\`.`,
  );
}
const pnpmVersion = packageManagerField.replace("pnpm@", "");

const nodeVersionFile = readFileSync(join(repoRoot, ".nvmrc"), "utf8").trim();
if (!/^22(\.|$)/.test(nodeVersionFile)) {
  fail(".nvmrc", null, `expected Node 22, found \`${nodeVersionFile}\`.`);
}

const files = yamlFilesIn(githubDir);
if (files.length === 0) {
  fail(".github", null, "no workflow or action YAML found.");
}
for (const file of files) {
  checkYamlFile(file, pnpmVersion);
}

if (problems.length > 0) {
  const report = problems
    .map(
      ({ file, line, message }) =>
        `  ${file}${line === null ? "" : `:${line}`} — ${message}`,
    )
    .join("\n");
  process.stderr.write(`CI configuration guard failed:\n${report}\n`);
  process.exit(1);
}

process.stdout.write(
  `CI configuration guard passed: ${files.length} file(s) checked, ` +
    `Node ${nodeVersionFile}, pnpm ${pnpmVersion}.\n`,
);
