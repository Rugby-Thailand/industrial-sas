import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const envExamplePath = join(repoRoot, ".env.example");
const contractPath = join(repoRoot, "src", "lib", "environmentContract.ts");

/** @type {{ file: string; message: string }[]} */
const problems = [];

/**
 * @param {string} file
 * @param {string} message
 */
const fail = (file, message) => problems.push({ file, message });

const contractSource = readFileSync(contractPath, "utf8");

const contractedVariables = [
  ...contractSource.matchAll(/^\s*variable:\s*"([A-Z0-9_]+)",$/gm),
].map((match) => match[1]);

if (contractedVariables.length === 0) {
  fail(
    "src/lib/environmentContract.ts",
    "no variable contracts found; the guard cannot verify a contract it cannot read.",
  );
}

/*
 * The class list, read from the `ENVIRONMENT_CLASSES` declaration itself rather
 * than from any line that happens to hold a class name. Prettier wraps a
 * `recommended: ["developer"]` entry onto its own indented line, so a
 * whole-file scan matches those too and reports seven classes where there are
 * four — a guard that fails for a formatting reason is a guard nobody trusts.
 */
const classBlock =
  /export const ENVIRONMENT_CLASSES = \[([^\]]*)\] as const;/.exec(
    contractSource,
  )?.[1] ?? "";
const classMatches = [...classBlock.matchAll(/"([a-z]+)"/g)].map(
  (match) => match[1],
);

if (classMatches.length !== 4) {
  fail(
    "src/lib/environmentContract.ts",
    `expected four environment classes, found ${classMatches.length}.`,
  );
}

const envExample = readFileSync(envExamplePath, "utf8");
const envLines = envExample.split("\n");

/** @type {Set<string>} */
const templated = new Set();

envLines.forEach((line, index) => {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (match === null) return;
  const [, name, value] = match;
  templated.add(name);
  if (value.trim().length > 0) {
    fail(
      `.env.example:${index + 1}`,
      `\`${name}\` has a value; the tracked template holds names only (INV-0012-05).`,
    );
  }
});

for (const variable of contractedVariables) {
  if (!templated.has(variable)) {
    fail(
      ".env.example",
      `\`${variable}\` is in the environment contract but not in the template.`,
    );
  }
}

for (const name of [...templated].sort()) {
  if (!name.startsWith("NEXT_PUBLIC_")) continue;
  if (contractedVariables.includes(name)) continue;

  fail(
    ".env.example",
    `\`${name}\` is inlined into the browser bundle but has no entry in the environment contract.`,
  );
}

const classArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--class="));

if (classArgument !== undefined) {
  const requested = classArgument.slice("--class=".length);
  if (!classMatches.includes(requested)) {
    fail(
      "--class",
      `\`${requested}\` is not an environment class; expected one of ${classMatches.join(", ")}.`,
    );
  } else {
    validateProcessEnvironment(requested);
  }
}

/**
 * @param {string} environmentClass
 */
function validateProcessEnvironment(environmentClass) {
  const blocks = contractSource.split(/\n\s*\{\n/).slice(1);
  for (const block of blocks) {
    const variable = /variable:\s*"([A-Z0-9_]+)"/.exec(block)?.[1];
    if (variable === undefined) continue;

    const requiredList = listAfter(block, "required");
    const forbiddenList = listAfter(block, "forbidden");
    const value = process.env[variable];
    const has = typeof value === "string" && value.trim().length > 0;

    if (requiredList.includes(environmentClass) && !has) {
      fail(
        `env:${environmentClass}`,
        `\`${variable}\` is required for this class and is unset.`,
      );
    }
    if (forbiddenList.includes(environmentClass) && has) {
      fail(
        `env:${environmentClass}`,
        `\`${variable}\` must not be set for this class.`,
      );
    }
  }
}

/**
 * @param {string} block
 * @param {"required" | "forbidden"} key
 * @returns {string[]}
 */
function listAfter(block, key) {
  const raw = new RegExp(`${key}:\\s*(\\[[^\\]]*\\]|[A-Z_]+)`).exec(block)?.[1];
  if (raw === undefined) return [];
  if (raw === "ALL") return [...classMatches];
  if (raw === "NONE") return [];
  if (raw === "DEPLOYED") return ["preview", "staging", "production"];
  return [...raw.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
}

if (problems.length > 0) {
  const report = problems
    .map(({ file, message }) => `  ${file} — ${message}`)
    .join("\n");
  process.stderr.write(`Environment contract guard failed:\n${report}\n`);
  process.exit(1);
}

process.stdout.write(
  `Environment contract guard passed: ${contractedVariables.length} contracted variable(s), ` +
    `${templated.size} template entr(y|ies), ${classMatches.length} classes` +
    `${classArgument === undefined ? "" : `, process environment checked as ${classArgument.slice(8)}`}.\n`,
);
