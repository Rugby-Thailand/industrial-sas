/**
 * Native-select guard.
 *
 * A `<select>` renders its popup with the *operating system's* widget, in the
 * operating system's colours. On a dark-scheme scanner that meant a white list
 * over a dark screen, on every screen that had one, and no page style could
 * reach it. Four production renderers had the defect independently, which is
 * what a defect looks like when the control is a browser default rather than a
 * decision — nobody chose it four times, and nobody would notice a fifth.
 *
 * So the rule is narrow and structural: **production source under `src/` may not
 * create a `<select>` element** outside the allowlist below. Every choose-one
 * control goes through `SelectControl`, which composes the shadcn/Radix
 * primitive.
 *
 * What this deliberately does **not** forbid:
 *
 * - `<option>`. It is meaningless without a `select`, and flagging it would be
 *   two rules for one thing.
 * - Radix's own hidden native control. It is created inside `radix-ui`, in
 *   `node_modules`, and is what keeps `name`/`value` working in a real form
 *   submission — nothing under `src/` writes it.
 * - Buttons, inputs, tables, labels, and links. The migration plan is explicit
 *   that enforcement stays incremental until the scanner and semantic exceptions
 *   are documented (§F.5), and a raw `<input>` in a keyboard-wedge flow is a
 *   decision somebody may still need to make.
 * - Test files. A test that renders a native select to prove something *about*
 *   native selects is doing its job.
 *
 * The check is AST-only. "select" appears in prose throughout this repository —
 * in the very comments explaining why the native control was replaced — and a
 * text scan would either flag those or be loosened until it flagged nothing.
 *
 * Run with `pnpm verify:native-select`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Production application source. */
const SCAN_DIRECTORY = "src";
const SKIPPED_DIRECTORIES = new Set(["node_modules", "__fixtures__", "tests"]);
const SKIPPED_FILES = /(?:\.d\.ts|\.(?:test|spec|a11y)\.tsx?)$/;
const SOURCE_FILES = /\.tsx?$/;

/**
 * Files that may still create a native `<select>`.
 *
 * **Empty, and it should stay that way.** An entry here is a claim that one
 * screen has a tested, device-specific reason to hand its popup to the operating
 * system — the migration plan requires exactly that justification — so each
 * addition needs the reason written beside it and the device it was measured on.
 * A file added tomorrow is denied without this list being touched.
 *
 * @type {readonly string[]}
 */
export const NATIVE_SELECT_ALLOWLIST = Object.freeze([]);

/** @typedef {{ file: string, line: number, message: string }} NativeSelectViolation */

/** Every production source file under a directory, repository-relative. */
export function productionFilesIn(directory, root) {
  if (!existsSync(directory)) return [];

  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...productionFilesIn(full, root));
      continue;
    }
    if (!SOURCE_FILES.test(entry.name)) continue;
    if (SKIPPED_FILES.test(entry.name)) continue;
    files.push(relative(root, full).split(sep).join("/"));
  }
  return files.sort();
}

/**
 * The tag name of a JSX element, when it is an intrinsic one.
 *
 * `<select>` is intrinsic and lower-case; `<Select>` is a component reference
 * and is exactly what this migration wants people writing. Only the first is a
 * finding.
 */
const intrinsicTagOf = (node) => {
  const tag =
    ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)
      ? node.tagName
      : undefined;
  if (tag === undefined || !ts.isIdentifier(tag)) return undefined;
  const name = tag.text;
  return name === name.toLowerCase() ? name : undefined;
};

/** `React.createElement("select", …)` and `createElement("select", …)`. */
const createElementLiteralOf = (node) => {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : undefined;
  if (name !== "createElement") return undefined;
  const first = node.arguments[0];
  return first !== undefined && ts.isStringLiteralLike(first)
    ? first.text
    : undefined;
};

/** @returns {NativeSelectViolation[]} */
export function collectNativeSelectViolations(root = repoRoot) {
  /** @type {NativeSelectViolation[]} */
  const violations = [];
  const allowed = new Set(NATIVE_SELECT_ALLOWLIST);

  for (const file of productionFilesIn(join(root, SCAN_DIRECTORY), root)) {
    if (allowed.has(file)) continue;

    const source = ts.createSourceFile(
      file,
      readFileSync(join(root, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const report = (node, message) => {
      violations.push({
        file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        message,
      });
    };

    const walk = (node) => {
      if (intrinsicTagOf(node) === "select") {
        report(
          node,
          "native <select>; use SelectControl (shadcn/Radix) so the menu is themed and testable",
        );
      }
      if (createElementLiteralOf(node) === "select") {
        report(
          node,
          'createElement("select"); use SelectControl (shadcn/Radix) so the menu is themed and testable',
        );
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }

  for (const path of allowed) {
    if (existsSync(join(root, path))) continue;
    violations.push({
      file: path,
      line: 0,
      message: "allowlisted path does not exist; update the allowlist",
    });
  }

  return violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
}

/** @param {NativeSelectViolation[]} violations @returns {string} */
export function formatNativeSelectReport(violations) {
  return violations
    .map(({ file, line, message }) => `  ${file}:${line} — ${message}`)
    .join("\n");
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const files = productionFilesIn(join(repoRoot, SCAN_DIRECTORY), repoRoot);
  const violations = collectNativeSelectViolations();
  if (violations.length > 0) {
    process.stderr.write(
      `Native select guard failed:\n${formatNativeSelectReport(violations)}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `Native select guard passed: ${files.length} production file(s) checked.\n`,
  );
}
