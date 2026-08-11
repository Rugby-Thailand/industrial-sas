/**
 * Environment contract guard.
 *
 * Two jobs, both of which fail the build rather than warn:
 *
 * 1. **`.env.example` covers the contract.** Every variable
 *    `src/lib/environmentContract.ts` has an opinion about is named in the
 *    template, and every `NEXT_PUBLIC_*` name in the template is one the
 *    contract knows — so a variable cannot be added to the code and forgotten in
 *    the template, or added to the template and never enforced.
 * 2. **`.env.example` holds no values.** The template is tracked; a filled one
 *    is a committed secret (`INV-0012-05`). Anything after `=` on a variable
 *    line is a failure, including a "harmless" default.
 *
 * Optionally, with `--class=<developer|preview|staging|production>`, it also
 * validates the *current* process environment against that class's contract.
 * That form is for a developer or a deploy step, not for CI: CI has no
 * environment to validate, which is the point of a credential-free pipeline.
 *
 * The contract itself lives in TypeScript because the application reads it too.
 * This script re-derives it from the source text rather than importing it,
 * because a Node script that needed a TypeScript loader would be a build step
 * in front of a guard — see `verify-workflows.mjs` for the same reasoning about
 * a YAML parser.
 *
 * Run with `pnpm verify:environment`.
 */
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

/* -------------------------------------------------------------------------- */
/* The contract, read out of its own source                                    */
/* -------------------------------------------------------------------------- */

const contractSource = readFileSync(contractPath, "utf8");

/**
 * Every `variable: "NAME"` in the contract table.
 *
 * A regex rather than a parse: the shape is a literal array of object literals
 * with one `variable` key each, and this script's failure mode should be "found
 * nothing" — which is checked below — not "silently matched the wrong thing".
 */
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

/* -------------------------------------------------------------------------- */
/* .env.example                                                                */
/* -------------------------------------------------------------------------- */

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
  // Only the public names are required to be contracted. A server-side name may
  // legitimately be documented ahead of the code that reads it; a public one is
  // inlined into the browser bundle, so it is a decision that needs a rule.
  fail(
    ".env.example",
    `\`${name}\` is inlined into the browser bundle but has no entry in the environment contract.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Optional: validate the running environment                                  */
/* -------------------------------------------------------------------------- */

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
 * Apply the required/forbidden lists to `process.env`.
 *
 * The lists are re-derived from the contract source the same way the variable
 * names were. This deliberately duplicates a little of the TypeScript module's
 * logic; the module's own behaviour is proved by `environmentContract.test.ts`,
 * and what this adds is the ability to run against a real machine with no
 * TypeScript toolchain in the path.
 *
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
 * The environment classes named on one `required:`/`forbidden:` line, including
 * through the `ALL`, `NONE`, and `DEPLOYED` aliases the contract defines.
 *
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

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

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
