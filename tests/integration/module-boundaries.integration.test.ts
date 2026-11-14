import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { FINISHED_GOODS_SOURCE_TABLES } from "../../convex/lib/finishedGoodsSummary";
import { PROJECTED_SOURCE_TABLES } from "../../convex/lib/schemaPolicy";
import { SEARCH_SOURCE_TABLES } from "../../convex/lib/searchIndexWrites";

/**
 * Import direction between the shared domain rules, the Convex backend and
 * the frontend (see docs/architecture/module-map.md).
 *
 * - `convex/model` is plain TypeScript shared by UI and backend. It imports
 *   only its own modules: no Convex runtime, schema/table helpers, React,
 *   Next or environment-specific packages. The one documented exception is
 *   a type-only use of generated document/ID types.
 * - Production frontend code reaches the backend through generated function
 *   references and `convex/model` rules. Other backend modules are allowed
 *   only as type-only imports, so no handler, schema or validator is bundled.
 *
 * Tests are exempt: they deliberately call registered handlers directly.
 */

const ROOT = process.cwd();
const MODEL = join(ROOT, "convex", "model");
const SRC = join(ROOT, "src");
const GENERATED_DATA_MODEL = join(ROOT, "convex", "_generated", "dataModel");

/** Reviewed exceptions: file → specifiers it may import type-only. */
const MODEL_TYPE_ONLY_EXCEPTIONS: Readonly<Record<string, readonly string[]>> =
  {
    "convex/model/finishedGoods/scanning.ts": [GENERATED_DATA_MODEL],
  };

interface ModuleImport {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

const importCache = new Map<
  string,
  {
    readonly text: string;
    readonly source: ts.SourceFile;
    readonly imports: ModuleImport[];
  }
>();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

function importsOf(file: string, text = readFileSync(file, "utf8")) {
  const cached = importCache.get(file);
  if (cached?.text === text) return cached.imports;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: ModuleImport[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every(
              (element) => element.isTypeOnly,
            )));
      found.push({ specifier: node.moduleSpecifier.text, typeOnly });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({
        specifier: node.moduleSpecifier.text,
        typeOnly:
          node.isTypeOnly ||
          (node.exportClause !== undefined &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 &&
            node.exportClause.elements.every((element) => element.isTypeOnly)),
      });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, typeOnly: false });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      found.push({
        specifier: node.moduleReference.expression.text,
        typeOnly: node.isTypeOnly,
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push({ specifier: node.argument.literal.text, typeOnly: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  importCache.set(file, { text, source, imports: found });
  return found;
}

const withoutExtension = (path: string) => path.replace(/\.(ts|tsx|js)$/, "");
const inside = (path: string, directory: string) =>
  path === directory || path.startsWith(directory + sep);
const display = (path: string) => relative(ROOT, path).split(sep).join("/");

/** Resolve relative and `@/` specifiers; bare packages stay unresolved. */
function resolved(file: string, specifier: string): string | null {
  if (specifier.startsWith("."))
    return withoutExtension(resolve(dirname(file), specifier));
  if (specifier.startsWith("@/"))
    return withoutExtension(join(SRC, specifier.slice(2)));
  return null;
}

const JOB_SCAN = join(SRC, "features/finishedGoods/jobScan");
const JOB_SCAN_SCREENS = ["JobScanScreen", "JobScanRecords"].map((name) =>
  join(JOB_SCAN, name),
);

function jobScanViolations(file: string, text: string): string[] {
  if (inside(file, JOB_SCAN)) return [];
  return importsOf(file, text).flatMap(({ specifier }) => {
    const target = resolved(file, specifier);
    if (target === null || !inside(target, JOB_SCAN)) return [];
    // Only route pages consume screen entries; all other internals, including
    // draft types, stay private. Shared barcode rules belong in convex/model.
    if (
      inside(file, join(SRC, "app")) &&
      /[/\\]page\.tsx?$/.test(file) &&
      JOB_SCAN_SCREENS.includes(target)
    )
      return [];
    return [`${display(file)} imports private jobScan module ${specifier}`];
  });
}

const NAVIGATION_CORE = [
  "src/lib/navigationGuard",
  "src/lib/browser/appHistory",
  "src/lib/browser/appHistoryMarkers",
  "src/lib/browser/history",
].map((path) => join(ROOT, path));

function navigationCycles(sources: ReadonlyMap<string, string>): string[] {
  const known = new Set([...sources.keys()].map(withoutExtension));
  const edges = new Map(
    [...sources].map(([file, text]) => [
      withoutExtension(file),
      importsOf(file, text).flatMap(({ specifier, typeOnly }) => {
        if (typeOnly) return [];
        const target = resolved(file, specifier);
        if (target === null) return [];
        const candidate = [target, join(target, "index")].find((path) =>
          known.has(path),
        );
        return candidate === undefined ? [] : [candidate];
      }),
    ]),
  );
  const cycles: string[] = [];
  for (const start of NAVIGATION_CORE) {
    const stack = [{ node: start, path: [start] }];
    const seen = new Set<string>([start]);
    while (stack.length > 0) {
      const { node, path } = stack.pop()!;
      for (const next of edges.get(node) ?? []) {
        if (next === start) {
          cycles.push([...path, next].map(display).join(" -> "));
          continue;
        }
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push({ node: next, path: [...path, next] });
      }
    }
  }
  return cycles;
}

/** Exact registration owners, never whole-file exemptions. */
const RAW_PUBLIC_OWNERS: Readonly<
  Record<string, { readonly builder: string; readonly reason: string }>
> = {
  "convex/lib/tenantFunctions.ts#queryWithOrg": {
    builder: "queryGeneric",
    reason: "tenant query registration implementation",
  },
  "convex/lib/tenantFunctions.ts#mutationWithOrg": {
    builder: "mutationGeneric",
    reason: "tenant mutation registration implementation",
  },
  "convex/lib/tenantFunctions.ts#actionWithOrg": {
    builder: "actionGeneric",
    reason: "tenant action registration implementation",
  },
  "convex/lib/clerkWebhook.ts#clerkWebhook": {
    builder: "httpActionGeneric",
    reason: "Clerk signature-verified HTTP ingress has no tenant session",
  },
  "convex/finishedGoods/attachments.ts#finalizeUpload": {
    builder: "mutation",
    reason:
      "sessionless provider callback verifies an HMAC upload receipt before writing the existing org-owned intent; see ai-attachments.md",
  },
};

const PUBLIC_BUILDERS = new Set([
  "query",
  "mutation",
  "action",
  "httpAction",
  "queryGeneric",
  "mutationGeneric",
  "actionGeneric",
  "httpActionGeneric",
]);

function publicBuilderViolations(file: string, text: string): string[] {
  const rawModule = (specifier: string) =>
    specifier === "convex/server" ||
    resolved(file, specifier) === join(ROOT, "convex/_generated/server");
  if (
    !importsOf(file, text).some(
      ({ specifier, typeOnly }) => !typeOnly && rawModule(specifier),
    )
  )
    return [];
  const source = importCache.get(file)!.source;
  const bindings = new Map<string, string>();
  const violations: string[] = [];
  const refuse = (detail: string) =>
    violations.push(`${display(file)}: ${detail}`);

  // Named imports make every raw builder auditable, including aliases. Reject
  // namespace/dynamic access and re-exports so a helper cannot launder a raw
  // constructor into a seemingly tenant-safe factory. internal* stays allowed.
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      if (
        !rawModule(statement.moduleSpecifier.text) ||
        statement.importClause?.isTypeOnly
      )
        continue;
      const named = statement.importClause?.namedBindings;
      if (named === undefined || !ts.isNamedImports(named)) {
        refuse("use named imports from Convex server entry points");
        continue;
      }
      for (const element of named.elements) {
        const builder = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly && PUBLIC_BUILDERS.has(builder)) {
          bindings.set(element.name.text, builder);
          if (
            !Object.entries(RAW_PUBLIC_OWNERS).some(
              ([owner, rule]) =>
                owner.startsWith(`${display(file)}#`) &&
                rule.builder === builder,
            )
          )
            refuse(`raw public builder ${builder}; use a tenant wrapper`);
        }
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      if (!rawModule(statement.moduleSpecifier.text) || statement.isTypeOnly)
        continue;
      const named = statement.exportClause;
      if (
        !named ||
        !ts.isNamedExports(named) ||
        named.elements.some(
          (element) =>
            !element.isTypeOnly &&
            PUBLIC_BUILDERS.has((element.propertyName ?? element.name).text),
        )
      )
        refuse("do not re-export raw public builders");
    }
  }

  const visit = (node: ts.Node) => {
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      rawModule(node.moduleReference.expression.text)
    )
      refuse("use named imports from Convex server entry points");
    if (
      ts.isIdentifier(node) &&
      bindings.has(node.text) &&
      !ts.isImportSpecifier(node.parent)
    ) {
      let owner: ts.Node = node;
      while (owner.parent !== source) owner = owner.parent;
      let name: string | undefined;
      if (ts.isFunctionDeclaration(owner)) name = owner.name?.text;
      if (ts.isVariableStatement(owner)) {
        let declaration: ts.Node = node;
        while (declaration !== owner && !ts.isVariableDeclaration(declaration))
          declaration = declaration.parent;
        if (
          ts.isVariableDeclaration(declaration) &&
          ts.isIdentifier(declaration.name)
        )
          name = declaration.name.text;
      }
      const rule = RAW_PUBLIC_OWNERS[`${display(file)}#${name}`];
      if (
        rule?.builder !== bindings.get(node.text) ||
        !ts.isCallExpression(node.parent) ||
        node.parent.expression !== node
      )
        refuse(
          `raw public builder ${node.text} outside its exact registration owner`,
        );
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      rawModule(node.arguments[0].text)
    )
      refuse("use named imports from Convex server entry points");
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

// All rules inspect the same source snapshot. Parse its import edges once;
// rescanning each tree for each boundary otherwise dominates this suite.
const PRODUCTION_SOURCES = new Map(
  [...sourceFiles(SRC), ...sourceFiles(join(ROOT, "convex"))].map((file) => [
    file,
    readFileSync(file, "utf8"),
  ]),
);
for (const [file, text] of PRODUCTION_SOURCES) importsOf(file, text);

describe("module import boundaries", () => {
  it("keeps convex/model free of Convex runtime, schema and framework imports", () => {
    const files = sourceFiles(MODEL);
    expect(files.length).toBeGreaterThan(40);
    const violations: string[] = [];
    for (const file of files) {
      const name = display(file);
      const allowed = MODEL_TYPE_ONLY_EXCEPTIONS[name] ?? [];
      for (const { specifier, typeOnly } of importsOf(file)) {
        const target = resolved(file, specifier);
        if (target !== null && inside(target, MODEL)) continue;
        if (target !== null && typeOnly && allowed.includes(target)) continue;
        violations.push(`${name} imports ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("lets production frontend code import only generated references and domain rules at runtime", () => {
    const backend = join(ROOT, "convex");
    const runtimeAllowed = [join(backend, "_generated"), MODEL];
    // This Next API route is a server-to-server integration, not browser code.
    // Clerk's server entry point also prevents it entering a client bundle.
    const serverAdapters: Readonly<Record<string, readonly string[]>> = {
      "src/app/api/uploadthing/core.ts": [join(backend, "lib/uploadReceipt")],
    };
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const { specifier, typeOnly } of importsOf(file)) {
        const target = resolved(file, specifier);
        if (target === null || !inside(target, backend) || typeOnly) continue;
        if (runtimeAllowed.some((directory) => inside(target, directory)))
          continue;
        if (serverAdapters[display(file)]?.includes(target)) continue;
        violations.push(`${display(file)} imports ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("has no runtime import cycle through the navigation history modules", () => {
    expect(
      navigationCycles(
        new Map(
          sourceFiles(SRC).map((file) => [file, readFileSync(file, "utf8")]),
        ),
      ),
    ).toEqual([]);
  });

  it("keeps jobScan internals private outside its route screen entries", () => {
    expect(
      sourceFiles(SRC).flatMap((file) =>
        jobScanViolations(file, readFileSync(file, "utf8")),
      ),
    ).toEqual([]);
  });

  it("registers public Convex functions only through tenant wrappers or exact reviewed owners", () => {
    const files = sourceFiles(join(ROOT, "convex")).filter(
      (file) => !inside(file, join(ROOT, "convex/_generated")),
    );
    expect(files.length).toBeGreaterThan(100);
    expect(
      files.flatMap((file) =>
        publicBuilderViolations(file, readFileSync(file, "utf8")),
      ),
    ).toEqual([]);
  });

  it.each([
    'import { newTicket } from "./jobScan/ticketDraft";',
    'import { newTicket } from "@/features/finishedGoods/jobScan/ticketDraft";',
    'import type { TicketDraft } from "./jobScan/ticketDraft";',
    'export { type TicketDraft } from "./jobScan/ticketDraft";',
    'export * from "./jobScan/ticketDraft";',
    'const later = import("./jobScan/ticketDraft");',
    'const draft = require("./jobScan/ticketDraft");',
    'import draft = require("./jobScan/ticketDraft");',
    'import { JobScanScreen } from "./jobScan/JobScanScreen";',
  ])("rejects a cross-feature jobScan edge: %s", (text) => {
    const violations = jobScanViolations(
      join(SRC, "features/finishedGoods/probe.ts"),
      text,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("imports private jobScan module");
    expect(() => expect(violations).toEqual([])).toThrow();
  });

  it("allows feature-local imports, shared model rules and exact route screen entries", () => {
    const fixtures = [
      [
        join(JOB_SCAN, "probe.ts"),
        'import type { TicketDraft } from "./ticketDraft";',
      ],
      [
        join(SRC, "features/finishedGoods/probe.ts"),
        'import { classifyTicketBarcode } from "../../../convex/model/finishedGoods/jobScans";',
      ],
      [
        join(SRC, "app/probe/page.tsx"),
        'import { JobScanScreen } from "@/features/finishedGoods/jobScan/JobScanScreen";',
      ],
      [
        join(SRC, "app/probe/page.tsx"),
        'import { JobScanRecordsScreen } from "../../features/finishedGoods/jobScan/JobScanRecords";',
      ],
    ] as const;
    for (const [file, text] of fixtures)
      expect(jobScanViolations(file, text)).toEqual([]);
    expect(
      jobScanViolations(
        join(SRC, "app/probe/page.tsx"),
        'import { newTicket } from "@/features/finishedGoods/jobScan/ticketDraft";',
      ),
    ).toHaveLength(1);
  });

  it.each([
    ["query", "../_generated/server"],
    ["mutation", "../_generated/server.js"],
    ["action", "../_generated/server"],
    ["httpAction", "../_generated/server"],
    ["queryGeneric", "convex/server"],
    ["mutationGeneric", "convex/server"],
    ["actionGeneric", "convex/server"],
    ["httpActionGeneric", "convex/server"],
  ])(
    "rejects a raw public %s function from %s (including aliases)",
    (builder, specifier) => {
      const file = join(ROOT, "convex/finishedGoods/probe.ts");
      const text = `import { ${builder} as register } from "${specifier}";
      export const unscoped = register({ handler: () => null });`;
      const violations = publicBuilderViolations(file, text);
      expect(violations[0]).toContain(
        `raw public builder ${builder}; use a tenant wrapper`,
      );
      expect(() => expect(violations).toEqual([])).toThrow();
    },
  );

  it.each([
    'import * as server from "../_generated/server"; export const unscoped = server.query({});',
    'const { mutation: register } = await import("../_generated/server"); export const unscoped = register({});',
    'const { actionGeneric } = require("convex/server"); export const unscoped = actionGeneric({});',
    'import server = require("../_generated/server"); export const unscoped = server.query({});',
    'export { query as hiddenBuilder } from "../_generated/server";',
    'export * from "convex/server";',
  ])("rejects indirect raw public builder access: %s", (text) => {
    expect(
      publicBuilderViolations(join(ROOT, "convex/finishedGoods/probe.ts"), text)
        .length,
    ).toBeGreaterThan(0);
  });

  it("allows tenant factories, internal registrations and erased server types", () => {
    const file = join(ROOT, "convex/storageLayouts/probe.ts");
    const text = `
      import { queryWithOrg as register } from "../lib/tenantFunctions";
      import { internalQuery, internalMutation, internalAction, type QueryCtx } from "../_generated/server";
      import { internalQueryGeneric, internalMutationGeneric, internalActionGeneric } from "convex/server";
      import type { query } from "../_generated/server";
      export { type action } from "../_generated/server";
      function storageBuildingQuery(includeInventory: boolean) {
        return register({ handler: () => includeInventory });
      }
      export const building = storageBuildingQuery(true);
      export const layout = storageBuildingQuery(false);
      export const read = internalQuery({});
      export const write = internalMutation({});
      export const act = internalAction({});
      export const genericRead = internalQueryGeneric({});
      export const genericWrite = internalMutationGeneric({});
      export const genericAct = internalActionGeneric({});
    `;
    expect(publicBuilderViolations(file, text)).toEqual([]);
    // A helper's name never exempts its constructor from the same guard.
    expect(
      publicBuilderViolations(
        file,
        text.replace(
          'import { queryWithOrg as register } from "../lib/tenantFunctions";',
          'import { query as register } from "../_generated/server";',
        ),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("limits each reviewed raw builder to its exact owner and constructor", () => {
    for (const [entry, { builder, reason }] of Object.entries(
      RAW_PUBLIC_OWNERS,
    )) {
      const [name, owner] = entry.split("#") as [string, string];
      const file = join(ROOT, name);
      const specifier = builder.endsWith("Generic")
        ? "convex/server"
        : "../_generated/server";
      const imported = `import { ${builder} as register } from "${specifier}";`;
      expect(reason.length).toBeGreaterThan(20);
      const allowed = `${imported} export const ${owner} = register({});`;
      expect(publicBuilderViolations(file, allowed)).toEqual([]);
      expect(
        publicBuilderViolations(
          file,
          `${allowed} export const surprise = register({});`,
        ),
      ).toHaveLength(1);
      expect(
        publicBuilderViolations(
          file,
          `${imported} export const ${owner} = register;`,
        ),
      ).toHaveLength(1);
      expect(
        publicBuilderViolations(
          file,
          allowed.replaceAll(builder, "httpAction"),
        ),
      ).not.toEqual([]);
    }
  });

  it.each([
    'import "@/lib/navigationGuard";',
    'export { guard } from "../navigationGuard";',
    'const later = import("../navigationGuard");',
    'const guard = require("../navigationGuard");',
    'import { type Guard, guard } from "../navigationGuard";',
  ])("rejects a runtime navigation cycle: %s", (closingEdge) => {
    const guard = join(ROOT, "src/lib/navigationGuard.ts");
    const history = join(ROOT, "src/lib/browser/history.ts");
    const bridge = join(ROOT, "src/lib/browser/probe/index.ts");
    const fixtures = new Map([
      [guard, 'import "./browser/history";'],
      [history, closingEdge],
    ]);
    const cycles = navigationCycles(fixtures);
    expect(cycles).toContain(
      "src/lib/navigationGuard -> src/lib/browser/history -> src/lib/navigationGuard",
    );
    expect(() => expect(cycles).toEqual([])).toThrow();
    // Follow intermediate modules and directory index resolution as well.
    fixtures.set(history, 'import "./probe";');
    fixtures.set(bridge, 'import "@/lib/navigationGuard";');
    expect(navigationCycles(fixtures)).not.toEqual([]);
  });

  it.each([
    'import type { Guard } from "../navigationGuard";',
    'import { type Guard } from "../navigationGuard";',
    'export type { Guard } from "../navigationGuard";',
    'export { type Guard } from "../navigationGuard";',
    'type Guard = import("../navigationGuard").Guard;',
  ])("ignores erased navigation edges: %s", (edge) => {
    expect(
      navigationCycles(
        new Map([
          [
            join(ROOT, "src/lib/navigationGuard.ts"),
            'import "./browser/history";',
          ],
          [join(ROOT, "src/lib/browser/history.ts"), edge],
        ]),
      ),
    ).toEqual([]);
  });

  it("keeps HR and generic tenant functions independent of inventory projections", () => {
    const backend = join(ROOT, "convex");
    const files = sourceFiles(backend).filter(
      (file) => !inside(file, join(backend, "_generated")),
    );
    const known = new Set(files.map(withoutExtension));
    const edges = new Map(
      files.map((file) => [
        withoutExtension(file),
        importsOf(file).flatMap(({ specifier, typeOnly }) => {
          const target = typeOnly ? null : resolved(file, specifier);
          return target !== null && known.has(target) ? [target] : [];
        }),
      ]),
    );
    const reach = (start: string) => {
      const seen = new Set<string>();
      const stack = [start];
      while (stack.length > 0)
        for (const next of edges.get(stack.pop()!) ?? [])
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
      return seen;
    };
    const projections = [
      "lib/inventoryWriter",
      "lib/finishedGoodsSummary",
      "lib/searchIndexWrites",
      "lib/zoneOccupancy",
      "lib/zoneSurfaces",
      "lib/warehouseTotals",
    ].map((path) => join(backend, path));
    const roots = [
      join(backend, "lib", "tenantFunctions"),
      ...files
        .filter((file) => inside(file, join(backend, "hr")))
        .map(withoutExtension),
    ];
    const violations = roots.flatMap((root) => {
      const reached = reach(root);
      return projections
        .filter((projection) => reached.has(projection))
        .map((projection) => `${display(root)} reaches ${display(projection)}`);
    });
    expect(roots.length).toBeGreaterThan(20);
    expect(violations).toEqual([]);
  });

  it("names every raw writer that can bypass the inventory writer", () => {
    // Internal mutations that write through `ctx.db` or their own tenant
    // database skip `mutationWithOrg`'s writer. Each one is reviewed here.
    const reviewed: Readonly<Record<string, string>> = {
      "convex/finishedGoods/moveBuildingMigration.ts":
        "patches only move building-index fields; no projection reads them",
      "convex/finishedGoods/searchIndexBackfill.ts":
        "reads sources and rebuilds the search projection",
      "convex/finishedGoods/totalsBackfill.ts":
        "reads sources and rebuilds warehouse totals",
      "convex/operations/duplicateAudit.ts": "reads only",
      "convex/storageLayouts/zoneOccupancyBackfill.ts":
        "reads sources and rebuilds zone occupancy",
      "convex/staging/annexDemo.ts":
        "local/staging seed; scripts/seed-local-test.mjs runs the backfills after it",
      "convex/staging/storageLayoutUiDemo.ts":
        "local/staging seed; scripts/seed-local-test.mjs runs the backfills after it",
      "convex/staging/e2eFixture.ts":
        "staging fixture; writes its own readiness rows",
      "convex/staging/jobScanDemo.ts":
        "local demo job scans; search readiness rebuilds them",
      "convex/staging/paginationDemo.ts":
        "local pagination seed; marks readiness incomplete for rebuild",
      "convex/staging/locationBuildingBackfill.ts":
        "operational migration of location parent IDs",
    };
    const source = new RegExp(`"(${[...PROJECTED_SOURCE_TABLES].join("|")})"`);
    const rawWrite =
      /ctx\.db\.(insert|patch|replace|delete)\(|createTenantDocumentAccess\(/;
    const backend = join(ROOT, "convex");
    const found = sourceFiles(backend)
      .filter(
        (file) =>
          !inside(file, join(backend, "_generated")) &&
          !inside(file, MODEL) &&
          display(file) !== "convex/lib/tenantFunctions.ts",
      )
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return rawWrite.test(text) && source.test(text);
      })
      .map(display)
      .sort();
    expect(found).toEqual(Object.keys(reviewed).sort());
  });

  it("refuses projected writes exactly for the tables the inventory trackers own", () => {
    expect([...PROJECTED_SOURCE_TABLES].sort()).toEqual(
      [
        ...new Set([...FINISHED_GOODS_SOURCE_TABLES, ...SEARCH_SOURCE_TABLES]),
      ].sort(),
    );
  });

  it("detects every import form it enforces", () => {
    const probe = join(MODEL, "probe.ts");
    const text = [
      'import { v } from "convex/values";',
      'import type { Doc } from "../_generated/dataModel";',
      'import { type Id } from "../_generated/dataModel";',
      'import { type A, b } from "./local";',
      'export { x } from "../lib/tenantTable";',
      'const later = import("react");',
      'type T = import("convex/server").GenericId<"x">;',
    ].join("\n");
    expect(importsOf(probe, text)).toEqual([
      { specifier: "convex/values", typeOnly: false },
      { specifier: "../_generated/dataModel", typeOnly: true },
      { specifier: "../_generated/dataModel", typeOnly: true },
      { specifier: "./local", typeOnly: false },
      { specifier: "../lib/tenantTable", typeOnly: false },
      { specifier: "react", typeOnly: false },
      { specifier: "convex/server", typeOnly: true },
    ]);
    expect(resolved(probe, "../lib/tenantTable")).toBe(
      join(ROOT, "convex", "lib", "tenantTable"),
    );
    expect(resolved(probe, "convex/values")).toBeNull();
  });
});
