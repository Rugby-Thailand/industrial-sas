/**
 * Tenant boundary guard.
 *
 * `convex/lib/tenantFunctions.ts` is the only registration path a public Convex
 * function may take, and `TenantDocumentAccess` is the only database a handler
 * may reach. Neither is a claim TypeScript can make: nothing stops a new module
 * from importing `mutationGeneric` and touching `ctx.db`, and the function that
 * results would compile, deploy, and read every tenant's rows.
 *
 * This script parses every production file under `convex/` with the TypeScript
 * parser already pinned here. Each rule carries an allowlist of exact
 * repository-relative paths:
 *
 *   - `registration`    a public registration builder — `queryGeneric`,
 *     `mutationGeneric`, `actionGeneric`, or `query`/`mutation`/`action` from a
 *     Convex server module — imported, aliased, re-exported, dynamically
 *     imported, or reached through a namespace.
 *   - `internal-registration` an internal Convex registration builder.
 *   - `http-registration` an HTTP action registration builder.
 *   - `raw-database`    a raw `.db` read, `["db"]` access, or `{ db }` binding.
 *   - `storage-factory` `createQueryTenantStorage`/`createMutationTenantStorage`.
 *   - `storage-port`    a `Tenant*StoragePort` type.
 *   - `allowlist-drift` an allowlisted path that no longer exists.
 *
 * A file added tomorrow is therefore denied without that list being touched.
 * The checks are AST-only on purpose: `ctx.db` and `TenantStoragePort` appear in
 * prose all over `convex/lib`, and a text scan would either flag the prose or be
 * loosened until it flagged nothing.
 *
 * Run with `pnpm verify:tenant-boundary`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Production Convex source: generated, vendored, and test trees are not it. */
const SCAN_DIRECTORY = "convex";
const SKIPPED_DIRECTORIES = new Set([
  "_generated",
  "node_modules",
  "__tests__",
  "__fixtures__",
  "fixtures",
  "tests",
]);
const SKIPPED_FILES = /(?:\.d\.ts|\.(?:test|spec|a11y)\.tsx?)$/;
const SOURCE_FILES = /\.tsx?$/;

/** Registration builders that only ever come from a Convex server module. */
const SCOPED_BUILDERS = new Set(["query", "mutation", "action"]);
/** Registration builders whose names are unambiguous wherever they appear. */
const DISTINCTIVE_BUILDERS = new Set([
  "queryGeneric",
  "mutationGeneric",
  "actionGeneric",
]);
const INTERNAL_SCOPED_BUILDERS = new Set([
  "internalQuery",
  "internalMutation",
  "internalAction",
]);
const INTERNAL_DISTINCTIVE_BUILDERS = new Set([
  "internalQueryGeneric",
  "internalMutationGeneric",
  "internalActionGeneric",
]);
const HTTP_SCOPED_BUILDERS = new Set(["httpAction"]);
const HTTP_DISTINCTIVE_BUILDERS = new Set(["httpActionGeneric"]);
/** The concrete Convex storage adapters. */
const STORAGE_FACTORIES = new Set([
  "createQueryTenantStorage",
  "createMutationTenantStorage",
]);
/** `TenantStoragePort`, `TenantQueryStoragePort`, and any future sibling. */
const STORAGE_PORT_NAME = /^Tenant\w*StoragePort$/;

/** Exact paths permitted to break each rule; everything absent is denied. */
export const TENANT_BOUNDARY_ALLOWLIST = Object.freeze({
  registration: Object.freeze(["convex/lib/tenantFunctions.ts"]),
  "internal-registration": Object.freeze([
    "convex/lib/identityMirrorConvex.ts",
    "convex/lib/tenantFunctions.ts",
  ]),
  "http-registration": Object.freeze(["convex/lib/clerkWebhook.ts"]),
  "raw-database": Object.freeze([
    "convex/lib/authorizationSeedConvex.ts",
    "convex/lib/identityMirrorConvex.ts",
    "convex/lib/tenantStorage.ts",
    "convex/lib/tenantContextLookups.ts",
  ]),
  "storage-factory": Object.freeze([
    "convex/lib/tenantStorage.ts",
    "convex/lib/tenantContextLookups.ts",
    "convex/lib/tenantFunctions.ts",
  ]),
  "storage-port": Object.freeze([
    "convex/lib/tenantDb.ts",
    "convex/lib/tenantStorage.ts",
  ]),
});

/**
 * @typedef {keyof typeof TENANT_BOUNDARY_ALLOWLIST | "allowlist-drift"} TenantBoundaryRule
 * @typedef {{ file: string; line: number | null; rule: TenantBoundaryRule; message: string }} TenantBoundaryViolation
 */

/** @param {string} specifier @returns {boolean} */
function isConvexServerModule(specifier) {
  return (
    specifier === "convex/server" ||
    /(?:^|\/)_generated\/server$/.test(specifier)
  );
}

/** The rule a name belongs to, wherever it came from. @param {string} name */
function classifyName(name) {
  if (DISTINCTIVE_BUILDERS.has(name)) return "registration";
  if (INTERNAL_DISTINCTIVE_BUILDERS.has(name)) {
    return "internal-registration";
  }
  if (HTTP_DISTINCTIVE_BUILDERS.has(name)) return "http-registration";
  if (STORAGE_FACTORIES.has(name)) return "storage-factory";
  if (STORAGE_PORT_NAME.test(name)) return "storage-port";
  return null;
}

/** @param {string} directory @param {string} root @returns {string[]} */
function productionFilesIn(directory, root) {
  /** @type {string[]} */
  const found = [];
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...productionFilesIn(full, root));
      }
    } else if (
      SOURCE_FILES.test(entry.name) &&
      !SKIPPED_FILES.test(entry.name)
    ) {
      found.push(relative(root, full).split(sep).join("/"));
    }
  }
  return found.sort();
}

/** `a.b` and `a["b"]` are the same access. @param {ts.Node} node */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteral(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

/**
 * Check one file's syntax tree.
 *
 * @param {string} file repository-relative path; the allowlist keys on it.
 * @param {string} source
 * @returns {TenantBoundaryViolation[]}
 */
export function scanTenantBoundarySource(file, source) {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** @type {TenantBoundaryViolation[]} */
  const violations = [];
  /** One report per rule per line: the same bypass is often several nodes. */
  const seen = new Set();

  /** @param {TenantBoundaryRule} rule @param {ts.Node} node @param {string} message */
  const report = (rule, node, message) => {
    if (TENANT_BOUNDARY_ALLOWLIST[rule].includes(file)) return;
    const line =
      tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    const key = `${rule}\u0000${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ file, line, rule, message });
  };

  // Namespace bindings first: `server.query(...)` is a registration only when
  // `server` is a Convex server module, and the import may sit below the use.
  /** @type {Set<string>} */
  const serverNamespaces = new Set();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;
    if (!isConvexServerModule(specifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      serverNamespaces.add(bindings.name.text);
    }
  }

  /**
   * The declared name, not the local alias.
   *
   * @param {string} from @param {"imports" | "re-exports"} verb
   * @param {readonly (ts.ImportSpecifier | ts.ExportSpecifier)[]} elements
   */
  const checkNamedBindings = (from, verb, elements) => {
    for (const element of elements) {
      const original = (element.propertyName ?? element.name).text;
      const rule = classifyName(original);
      if (rule !== null) {
        report(rule, element, `${verb} \`${original}\` from "${from}"`);
      } else if (SCOPED_BUILDERS.has(original) && isConvexServerModule(from)) {
        report(
          "registration",
          element,
          `${verb} the registration builder \`${original}\` from "${from}"`,
        );
      } else if (
        INTERNAL_SCOPED_BUILDERS.has(original) &&
        isConvexServerModule(from)
      ) {
        report(
          "internal-registration",
          element,
          `${verb} the internal registration builder \`${original}\` from "${from}"`,
        );
      } else if (
        HTTP_SCOPED_BUILDERS.has(original) &&
        isConvexServerModule(from)
      ) {
        report(
          "http-registration",
          element,
          `${verb} the HTTP registration builder \`${original}\` from "${from}"`,
        );
      }
    }
  };

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const from = node.moduleSpecifier.text;
      const clause = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause;
      const verb = ts.isImportDeclaration(node) ? "imports" : "re-exports";
      if (clause && (ts.isNamedImports(clause) || ts.isNamedExports(clause))) {
        checkNamedBindings(from, verb, clause.elements);
      } else if (ts.isExportDeclaration(node) && isConvexServerModule(from)) {
        // `export *` and `export * as ns` re-export every builder unnamed.
        report("registration", node, `re-exports all of "${from}"`);
        report("internal-registration", node, `re-exports all of "${from}"`);
        report("http-registration", node, `re-exports all of "${from}"`);
      }
    }

    // `await import("convex/server")` hands over the builders with no
    // identifier to flag.
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [first] = node.arguments;
      if (
        first &&
        ts.isStringLiteral(first) &&
        isConvexServerModule(first.text)
      ) {
        report("registration", node, `dynamically imports "${first.text}"`);
        report(
          "internal-registration",
          node,
          `dynamically imports "${first.text}"`,
        );
        report(
          "http-registration",
          node,
          `dynamically imports "${first.text}"`,
        );
      }
    }

    const member = memberName(node);
    if (member !== null) {
      const object = /** @type {ts.PropertyAccessExpression} */ (node)
        .expression;
      const rule = classifyName(member);
      if (member === "db") {
        report("raw-database", node, "reaches the raw `db` handle");
      } else if (rule !== null) {
        report(rule, node, `reaches \`${member}\``);
      } else if (
        SCOPED_BUILDERS.has(member) &&
        ts.isIdentifier(object) &&
        serverNamespaces.has(object.text)
      ) {
        report(
          "registration",
          node,
          `reaches \`${member}\` on the Convex server namespace \`${object.text}\``,
        );
      } else if (
        INTERNAL_SCOPED_BUILDERS.has(member) &&
        ts.isIdentifier(object) &&
        serverNamespaces.has(object.text)
      ) {
        report(
          "internal-registration",
          node,
          `reaches \`${member}\` on the Convex server namespace \`${object.text}\``,
        );
      } else if (
        HTTP_SCOPED_BUILDERS.has(member) &&
        ts.isIdentifier(object) &&
        serverNamespaces.has(object.text)
      ) {
        report(
          "http-registration",
          node,
          `reaches \`${member}\` on the Convex server namespace \`${object.text}\``,
        );
      }
    }

    if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) && key.text === "db") {
        report("raw-database", node, "destructures the raw `db` handle");
      }
    }

    // Whatever is left: a call, a type position, an aliased local, or a
    // declaration of a look-alike port.
    if (ts.isIdentifier(node)) {
      const rule = classifyName(node.text);
      if (rule !== null) report(rule, node, `references \`${node.text}\``);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(tree, visit);
  return violations;
}

/**
 * @param {string} [root] repository root; defaults to this repository.
 * @returns {TenantBoundaryViolation[]} sorted by file, then line.
 */
export function collectTenantBoundaryViolations(root = repoRoot) {
  /** @type {TenantBoundaryViolation[]} */
  const violations = [];
  for (const file of productionFilesIn(join(root, SCAN_DIRECTORY), root)) {
    violations.push(
      ...scanTenantBoundarySource(file, readFileSync(join(root, file), "utf8")),
    );
  }

  // A rename must fail loudly: an allowlist entry that points at nothing is an
  // exemption nobody can see being used.
  const allowlisted = new Set(
    Object.values(TENANT_BOUNDARY_ALLOWLIST).flatMap((paths) => [...paths]),
  );
  for (const path of [...allowlisted].sort()) {
    if (existsSync(join(root, path))) continue;
    violations.push({
      file: path,
      line: null,
      rule: "allowlist-drift",
      message: "allowlisted path does not exist; update the allowlist",
    });
  }

  return violations.sort(
    (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0),
  );
}

/** @param {TenantBoundaryViolation[]} violations @returns {string} */
export function formatTenantBoundaryReport(violations) {
  return violations
    .map(
      ({ file, line, rule, message }) =>
        `  ${file}${line === null ? "" : `:${line}`} — [${rule}] ${message}`,
    )
    .join("\n");
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const files = productionFilesIn(join(repoRoot, SCAN_DIRECTORY), repoRoot);
  const violations = collectTenantBoundaryViolations();
  if (violations.length > 0) {
    process.stderr.write(
      `Tenant boundary guard failed:\n${formatTenantBoundaryReport(violations)}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `Tenant boundary guard passed: ${files.length} production Convex file(s) checked.\n`,
  );
}
