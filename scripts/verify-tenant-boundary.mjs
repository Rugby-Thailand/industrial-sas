import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

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

const SCOPED_BUILDERS = new Set(["query", "mutation", "action"]);

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

const STORAGE_FACTORIES = new Set([
  "createQueryTenantStorage",
  "createMutationTenantStorage",
]);

const STORAGE_PORT_NAME = /^Tenant\w*StoragePort$/;

const TENANT_WRAPPERS = new Set([
  "queryWithOrg",
  "mutationWithOrg",
  "actionWithOrg",
]);

const APPEND_ONLY_TABLES = new Set([
  "auditEvents",
  "inventoryTransactions",
  "inventoryLedgerLines",
]);

const REWRITING_METHODS = new Set(["patch", "replace", "delete"]);

const PROJECTION_TABLES = new Set(["inventoryBalances"]);
const WRITING_METHODS = new Set(["insert", "patch", "replace", "delete"]);

const UNBOUNDED_READ_METHODS = new Set(["collect", "fullTableScan"]);

const QUERY_CHAIN_NAMES = new Set([
  "db",
  "query",
  "withIndex",
  "withSearchIndex",
  "byIndex",
  "indexedPage",
]);

const SCHEMA_FILE = "convex/schema.ts";

const GLOBAL_TABLES = new Set(["organizations", "users", "permissions"]);

const TENANT_DISCRIMINATOR = "orgId";

const PERMISSION_CATALOGUE_FILE = "convex/lib/permissions.ts";

const PURE_MODEL_PREFIX = "convex/model/";

export const TENANT_BOUNDARY_ALLOWLIST = Object.freeze({
  registration: Object.freeze(["convex/lib/tenantFunctions.ts"]),
  "internal-registration": Object.freeze([
    "convex/engineering/files.ts",
    // Developer-only, confirmation-gated demo seed. The helper validates the
    // organization/warehouse relationship before creating tenant rows.
    "convex/lib/demoDataSeed.ts",
    "convex/lib/identityMirrorConvex.ts",
    "convex/lib/taskFileComplete.ts",
    "convex/lib/transportFileComplete.ts",
    "convex/lib/tenantFunctions.ts",
  ]),
  "http-registration": Object.freeze([
    "convex/lib/clerkWebhook.ts",
    "convex/lib/privateFileDownload.ts",
    "convex/lib/privateFileUpload.ts",
    "convex/lib/uploadThingComplete.ts",
  ]),
  "raw-database": Object.freeze([
    "convex/lib/authorizationLookupsConvex.ts",
    "convex/lib/authorizationSeedConvex.ts",
    // Developer-only, confirmation-gated demo seed. Raw access is necessary
    // because the Convex CLI does not carry an authenticated tenant context.
    "convex/lib/demoDataSeed.ts",
    "convex/lib/identityMirrorConvex.ts",
    // The opaque, one-use file grant is intentionally redeemed without caller
    // tenancy: possession of the random grant ID is the short-lived capability.
    "convex/engineering/files.ts",
    "convex/lib/taskFileComplete.ts",

    "convex/lib/transportFileComplete.ts",
    "convex/lib/tenantStorage.ts",

    "convex/lib/tenantFunctions.ts",
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

  "balance-projection-seam": Object.freeze([
    "convex/lib/inventoryLedgerStore.ts",
  ]),

  "authorization-declaration": Object.freeze([]),
  "audit-append-only": Object.freeze([]),
  "unbounded-read": Object.freeze([]),
  "tenant-index-prefix": Object.freeze([]),
  "model-purity": Object.freeze([]),
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

/**
 * @param {string} file repository-relative path of the importing file
 * @param {string} specifier
 * @returns {boolean}
 */
function escapesPureModel(file, specifier) {
  if (!specifier.startsWith(".")) return true;
  const segments = file.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return !`${segments.join("/")}`.startsWith(PURE_MODEL_PREFIX);
}

/** `a.b` and `a["b"]` are the same access. @param {ts.Node} node */ function memberName(
  node,
) {
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
 * @param {ts.Node} node
 * @returns {boolean}
 */
function isQueryChain(node) {
  let found = false;
  /** @param {ts.Node} current */
  const visit = (current) => {
    if (found) return;
    const member = memberName(current);
    if (member !== null && QUERY_CHAIN_NAMES.has(member)) {
      found = true;
      return;
    }
    if (ts.isIdentifier(current) && QUERY_CHAIN_NAMES.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/**
 * @param {ts.SourceFile} tree
 * @param {(rule: TenantBoundaryRule, node: ts.Node, message: string) => void} report
 */
function checkTenantIndexPrefixes(tree, report) {
  /** @param {ts.Node} node @returns {ts.ObjectLiteralExpression | null} */
  const schemaObject = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineSchema"
    ) {
      const [first] = node.arguments;
      if (first !== undefined && ts.isObjectLiteralExpression(first)) {
        return first;
      }
    }
    let found = null;
    ts.forEachChild(node, (child) => {
      if (found === null) found = schemaObject(child);
    });
    return found;
  };

  const schema = schemaObject(tree);
  if (schema === null) return;

  for (const property of schema.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) {
      continue;
    }
    const table = property.name.text;
    if (GLOBAL_TABLES.has(table)) continue;

    /** @param {ts.Node} node */
    const visitIndexes = (node) => {
      if (
        ts.isCallExpression(node) &&
        memberName(node.expression) === "index" &&
        node.arguments.length >= 2
      ) {
        const fields = node.arguments[1];
        const declaredByHelper =
          fields !== undefined &&
          ts.isCallExpression(fields) &&
          ts.isIdentifier(fields.expression) &&
          fields.expression.text === "byOrg";
        const firstLiteralField =
          fields !== undefined && ts.isArrayLiteralExpression(fields)
            ? fields.elements[0]
            : undefined;
        const declaredByLiteral =
          firstLiteralField !== undefined &&
          ts.isStringLiteral(firstLiteralField) &&
          firstLiteralField.text === TENANT_DISCRIMINATOR;

        if (!declaredByHelper && !declaredByLiteral) {
          report(
            "tenant-index-prefix",
            node,
            `declares an index on tenant table \`${table}\` whose fields do not begin ` +
              `with "${TENANT_DISCRIMINATOR}" (D-18, INV-0002-02)`,
          );
        }
      }
      ts.forEachChild(node, visitIndexes);
    };
    visitIndexes(property.initializer);
  }
}

/**
 * @param {string} root
 * @returns {Map<string, string> | null} code to scope
 */
export function readPermissionCatalogue(root) {
  const path = join(root, PERMISSION_CATALOGUE_FILE);
  if (!existsSync(path)) return null;

  const tree = ts.createSourceFile(
    PERMISSION_CATALOGUE_FILE,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  /** @type {Map<string, string>} */
  const catalogue = new Map();

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "permission"
    ) {
      const [code, scope] = node.arguments;
      if (
        code !== undefined &&
        ts.isStringLiteral(code) &&
        scope !== undefined &&
        ts.isStringLiteral(scope)
      ) {
        catalogue.set(code.text, scope.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(tree, visit);
  return catalogue.size === 0 ? null : catalogue;
}

/**
 * @param {string} file repository-relative path; the allowlist keys on it.
 * @param {string} source
 * @param {Map<string, string> | null} [catalogue] code-to-scope map from
 *   `readPermissionCatalogue`; `null` means it could not be read, and every
 *   declaration then fails closed.
 * @returns {TenantBoundaryViolation[]}
 */
export function scanTenantBoundarySource(file, source, catalogue = null) {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** @type {TenantBoundaryViolation[]} */
  const violations = [];

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

  /** @type {Set<string>} */
  const serverNamespaces = new Set();

  const wrapperNames = new Set(TENANT_WRAPPERS);
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (isConvexServerModule(specifier.text)) {
      if (bindings && ts.isNamespaceImport(bindings)) {
        serverNamespaces.add(bindings.name.text);
      }
    }
    // `import { queryWithOrg as register }` must not hide a declaration: the
    // alias is checked under the name it was given.
    if (
      /(?:^|\/)tenantFunctions$/.test(specifier.text) &&
      bindings &&
      ts.isNamedImports(bindings)
    ) {
      for (const element of bindings.elements) {
        const original = (element.propertyName ?? element.name).text;
        if (TENANT_WRAPPERS.has(original)) wrapperNames.add(element.name.text);
      }
    }
  }

  /**
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

  /**
   * @param {ts.CallExpression} node @param {string} callee
   */
  const checkDeclaration = (node, callee) => {
    const [definition] = node.arguments;
    if (definition === undefined || !ts.isObjectLiteralExpression(definition)) {
      report(
        "authorization-declaration",
        node,
        `calls \`${callee}\` with a definition this guard cannot read`,
      );
      return;
    }

    const declared = definition.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "permissionCode",
    );
    if (declared === undefined || !ts.isPropertyAssignment(declared)) {
      report(
        "authorization-declaration",
        node,
        `calls \`${callee}\` without a \`permissionCode\` (INV-0006-01)`,
      );
      return;
    }
    if (!ts.isStringLiteral(declared.initializer)) {
      report(
        "authorization-declaration",
        declared,
        "declares a `permissionCode` that is not a string literal",
      );
      return;
    }

    const code = declared.initializer.text;
    if (catalogue === null) {
      report(
        "authorization-declaration",
        declared,
        `cannot verify "${code}": ${PERMISSION_CATALOGUE_FILE} was not readable`,
      );
      return;
    }
    const scope = catalogue.get(code);
    if (scope === undefined) {
      report(
        "authorization-declaration",
        declared,
        `declares "${code}", which the code-owned catalogue does not define`,
      );
      return;
    }
    if (scope === "PLATFORM") {
      report(
        "authorization-declaration",
        declared,
        `declares the PLATFORM code "${code}", which no tenant role may hold`,
      );
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
      if (file.startsWith(PURE_MODEL_PREFIX) && escapesPureModel(file, from)) {
        report(
          "model-purity",
          node,
          `${verb} "${from}", which is outside ${PURE_MODEL_PREFIX} (plan §6.2)`,
        );
      }
      if (clause && (ts.isNamedImports(clause) || ts.isNamedExports(clause))) {
        checkNamedBindings(from, verb, clause.elements);
      } else if (ts.isExportDeclaration(node) && isConvexServerModule(from)) {
        report("registration", node, `re-exports all of "${from}"`);
        report("internal-registration", node, `re-exports all of "${from}"`);
        report("http-registration", node, `re-exports all of "${from}"`);
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [first] = node.arguments;
      if (first && ts.isStringLiteral(first)) {
        if (
          file.startsWith(PURE_MODEL_PREFIX) &&
          escapesPureModel(file, first.text)
        ) {
          report(
            "model-purity",
            node,
            `dynamically imports "${first.text}", which is outside ${PURE_MODEL_PREFIX} (plan §6.2)`,
          );
        }
        if (isConvexServerModule(first.text)) {
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
      } else if (file.startsWith(PURE_MODEL_PREFIX)) {
        report(
          "model-purity",
          node,
          "dynamically imports a specifier this guard cannot read (plan §6.2)",
        );
      }
    }

    if (
      file.startsWith(PURE_MODEL_PREFIX) &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      const [first] = node.arguments;
      report(
        "model-purity",
        node,
        first && ts.isStringLiteral(first)
          ? `requires "${first.text}" (plan §6.2: no CommonJS escape hatch)`
          : "requires a specifier this guard cannot read (plan §6.2)",
      );
    }
    if (
      file.startsWith(PURE_MODEL_PREFIX) &&
      ts.isImportEqualsDeclaration(node)
    ) {
      const reference = node.moduleReference;
      const specifier =
        ts.isExternalModuleReference(reference) &&
        ts.isStringLiteral(reference.expression)
          ? reference.expression.text
          : null;
      if (specifier === null || escapesPureModel(file, specifier)) {
        report(
          "model-purity",
          node,
          specifier === null
            ? "declares an import-equals this guard cannot read (plan §6.2)"
            : `imports "${specifier}" through import-equals, which is outside ${PURE_MODEL_PREFIX} (plan §6.2)`,
        );
      }
    }

    // A wrapper call must declare an enforceable permission, and a call to an
    // append-only table must not be a rewrite. Both are call shapes, so they are
    // checked here rather than by name.
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : memberName(node.expression);

      if (callee !== null && wrapperNames.has(callee)) {
        checkDeclaration(node, callee);
      }
      if (callee !== null && REWRITING_METHODS.has(callee)) {
        const [table] = node.arguments;
        if (
          table !== undefined &&
          ts.isStringLiteral(table) &&
          APPEND_ONLY_TABLES.has(table.text)
        ) {
          report(
            "audit-append-only",
            node,
            `calls \`${callee}("${table.text}", …)\` on an append-only table`,
          );
        }
      }
      if (callee !== null && WRITING_METHODS.has(callee)) {
        const [table] = node.arguments;
        if (
          table !== undefined &&
          ts.isStringLiteral(table) &&
          PROJECTION_TABLES.has(table.text)
        ) {
          report(
            "balance-projection-seam",
            node,
            `calls \`${callee}("${table.text}", …)\` outside the ledger persistence seam`,
          );
        }
      }
      if (callee !== null && UNBOUNDED_READ_METHODS.has(callee)) {
        report(
          "unbounded-read",
          node,
          `calls \`${callee}()\`, which has no bound (INV-0002-04)`,
        );
      }
      if (
        callee === "filter" &&
        ts.isPropertyAccessExpression(node.expression) &&
        isQueryChain(node.expression.expression)
      ) {
        report(
          "unbounded-read",
          node,
          "calls `filter()` on a database query chain; use a declared orgId-first index",
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

    if (ts.isIdentifier(node)) {
      const rule = classifyName(node.text);
      if (rule !== null) report(rule, node, `references \`${node.text}\``);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(tree, visit);
  if (file === SCHEMA_FILE) checkTenantIndexPrefixes(tree, report);
  return violations;
}

/**
 * @param {string} [root] repository root; defaults to this repository.
 * @returns {TenantBoundaryViolation[]} sorted by file, then line.
 */
export function collectTenantBoundaryViolations(root = repoRoot) {
  /** @type {TenantBoundaryViolation[]} */
  const violations = [];
  const catalogue = readPermissionCatalogue(root);
  for (const file of productionFilesIn(join(root, SCAN_DIRECTORY), root)) {
    violations.push(
      ...scanTenantBoundarySource(
        file,
        readFileSync(join(root, file), "utf8"),
        catalogue,
      ),
    );
  }

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
