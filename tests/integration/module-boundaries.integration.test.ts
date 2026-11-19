import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";
import { ESLint } from "eslint";
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
  readonly indirect?: boolean;
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
      const typeOnly = clause?.isTypeOnly === true;
      found.push({ specifier: node.moduleSpecifier.text, typeOnly });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: node.isTypeOnly,
      });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({
        specifier: node.arguments[0].text,
        typeOnly: false,
        indirect: true,
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      found.push({
        specifier: node.moduleReference.expression.text,
        typeOnly: node.isTypeOnly,
        indirect: true,
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      found.push({
        specifier: node.argument.literal.text,
        typeOnly: true,
        indirect: true,
      });
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
// ESLint owns static edges. Its import rule cannot see dynamic/require/type expressions.
function jobScanViolations(file: string, text: string): string[] {
  if (inside(file, JOB_SCAN)) return [];
  return importsOf(file, text).flatMap(({ specifier, indirect }) => {
    const target = indirect ? resolved(file, specifier) : null;
    return target !== null && inside(target, JOB_SCAN)
      ? [`${display(file)} imports private jobScan module ${specifier}`]
      : [];
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

/** Exact owners; the sessionless ingress reasons are recorded in module-map.md. */
const RAW_PUBLIC_OWNERS: Readonly<Record<string, string>> = {
  "convex/lib/tenantFunctions.ts#queryWithOrg": "queryGeneric",
  "convex/lib/tenantFunctions.ts#mutationWithOrg": "mutationGeneric",
  "convex/lib/tenantFunctions.ts#actionWithOrg": "actionGeneric",
  "convex/lib/clerkWebhook.ts#clerkWebhook": "httpActionGeneric",
  "convex/finishedGoods/attachments.ts#finalizeUpload": "mutation",
};

const RAW_BUILDER = /^(query|mutation|action|httpAction)(Generic)?$/;

/** Only the gaps in no-restricted-imports: indirect access, re-exports and exact owner use. */
function registrationOwnerViolations(file: string, text: string): string[] {
  const rawModule = (specifier: string) =>
    specifier === "convex/server" ||
    resolved(file, specifier) === join(ROOT, "convex/_generated/server");
  const edges = importsOf(file, text);
  const violations = edges
    .filter(
      ({ specifier, typeOnly, indirect }) =>
        !typeOnly && indirect && rawModule(specifier),
    )
    .map(({ specifier }) => `${display(file)} indirectly imports ${specifier}`);
  const source = importCache.get(file)!.source;
  // An owner's allowed import must not become a module others can import.
  for (const statement of source.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !rawModule(statement.moduleSpecifier.text)
    )
      continue;
    const clause = statement.exportClause;
    const reexported =
      !clause ||
      (ts.isNamedExports(clause) &&
        clause.elements.some(
          (element) =>
            !element.isTypeOnly &&
            RAW_BUILDER.test((element.propertyName ?? element.name).text),
        ));
    if (reexported)
      violations.push(
        `${display(file)} re-exports a raw builder from ${statement.moduleSpecifier.text}`,
      );
  }
  const owners = Object.entries(RAW_PUBLIC_OWNERS).filter(([owner]) =>
    owner.startsWith(`${display(file)}#`),
  );
  const bindings = new Map<string, string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !rawModule(statement.moduleSpecifier.text) ||
      statement.importClause?.isTypeOnly
    )
      continue;
    const named = statement.importClause?.namedBindings;
    // A path ESLint's pattern does not normalize still resolves to the raw module.
    if (named && ts.isNamespaceImport(named))
      violations.push(
        `${display(file)} imports raw module ${statement.moduleSpecifier.text} as a namespace`,
      );
    if (named && ts.isNamedImports(named))
      for (const element of named.elements) {
        const builder = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly && RAW_BUILDER.test(builder))
          bindings.set(element.name.text, builder);
      }
  }
  if (!owners.length)
    return [
      ...violations,
      ...[...bindings.values()].map(
        (builder) =>
          `${display(file)} imports raw builder ${builder} outside an exact registration owner`,
      ),
    ];
  const visit = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      bindings.has(node.text) &&
      !ts.isImportSpecifier(node.parent)
    ) {
      let owner: ts.Node = node;
      while (owner.parent !== source) owner = owner.parent;
      const declaration = ts.isVariableStatement(owner)
        ? owner.declarationList.declarations.find(
            (entry) => entry.pos <= node.pos && entry.end >= node.end,
          )
        : undefined;
      const name = ts.isFunctionDeclaration(owner)
        ? owner.name?.text
        : declaration && ts.isIdentifier(declaration.name)
          ? declaration.name.text
          : undefined;
      const rule = RAW_PUBLIC_OWNERS[`${display(file)}#${name}`];
      if (
        rule !== bindings.get(node.text) ||
        !ts.isCallExpression(node.parent) ||
        node.parent.expression !== node
      )
        violations.push(
          `${display(file)}: raw public builder ${node.text} outside its exact registration owner`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

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
        registrationOwnerViolations(file, readFileSync(file, "utf8")),
      ),
    ).toEqual([]);
  });

  it("rejects static boundary violations through ESLint, including aliases, namespaces and re-exports", async () => {
    const eslint = new ESLint();
    const backend = "convex/finishedGoods/probe.ts";
    const frontend = "src/features/finishedGoods/probe.ts";
    const route = "src/app/[locale]/(desktop)/finished-goods/scan/";
    const restricted = async (text: string, filePath: string) => {
      const [result] = await eslint.lintText(text, { filePath });
      return result!.messages.filter(
        (message) =>
          message.ruleId === "@typescript-eslint/no-restricted-imports",
      );
    };
    for (const builder of [
      "query",
      "mutation",
      "action",
      "httpAction",
      "queryGeneric",
      "mutationGeneric",
      "actionGeneric",
      "httpActionGeneric",
    ])
      expect(
        await restricted(
          `import { ${builder} as register } from "../_generated/server";`,
          backend,
        ),
      ).not.toEqual([]);
    for (const text of [
      'import * as server from "convex/server";',
      'import { query } from "../_generated/./server";',
      'import { query } from "../_generated//server";',
      'export { query as hidden } from "../_generated/server.js";',
      'export * from "convex/server";',
    ])
      expect(await restricted(text, backend)).not.toEqual([]);
    for (const text of [
      'import type { TicketDraft } from "./jobScan/ticketDraft";',
      'export { type TicketDraft } from "@/features/finishedGoods/jobScan/ticketDraft";',
    ])
      expect(await restricted(text, frontend)).not.toEqual([]);
    for (const [page, entry] of [
      ["page.tsx", "JobScanScreen"],
      ["records/page.tsx", "JobScanRecords"],
    ]) {
      expect(
        await restricted(
          'import { newTicket } from "@/features/finishedGoods/jobScan/ticketDraft";',
          route + page,
        ),
      ).not.toEqual([]);
      expect(
        await restricted(
          `import * as screen from "@/features/finishedGoods/jobScan/${entry}";`,
          route + page,
        ),
      ).toEqual([]);
    }
    for (const text of [
      'import { internalQuery } from "../_generated/server";',
      'import type { query } from "../_generated/server";',
    ])
      expect(await restricted(text, backend)).toEqual([]);
    for (const [entry, builder] of Object.entries(RAW_PUBLIC_OWNERS)) {
      const file = entry.split("#")[0]!;
      const source = builder.endsWith("Generic")
        ? "convex/server"
        : "../_generated/server";
      expect(
        await restricted(`import { ${builder} } from "${source}";`, file),
      ).toEqual([]);
    }
  });

  it("rejects dynamic private imports and raw constructors outside exact owners", () => {
    for (const text of [
      'const later = import("./jobScan/ticketDraft");',
      "const later = import(`./jobScan/ticketDraft`);",
      'const draft = require("./jobScan/ticketDraft");',
      'import draft = require("./jobScan/ticketDraft");',
      'type Draft = import("./jobScan/ticketDraft").TicketDraft;',
    ])
      expect(
        jobScanViolations(join(SRC, "features/finishedGoods/probe.ts"), text),
      ).toHaveLength(1);
    for (const text of [
      'import { query } from "../_generated//server";',
      'import { query as q } from "./../_generated/./server.js";',
      'import * as server from "../_generated//server";',
      'const server = import("convex/server");',
      "const server = require(`../_generated/server`);",
      'const server = require("../_generated/server");',
      'import server = require("../_generated/server");',
    ])
      expect(
        registrationOwnerViolations(
          join(ROOT, "convex/finishedGoods/probe.ts"),
          text,
        ),
      ).not.toEqual([]);
    for (const [entry, builder] of Object.entries(RAW_PUBLIC_OWNERS)) {
      const [file, owner] = entry.split("#");
      const imported = `import { ${builder} as register } from "${builder.endsWith("Generic") ? "convex/server" : "../_generated/server"}";`;
      expect(
        registrationOwnerViolations(
          join(ROOT, file!),
          `${imported} export const ${owner} = register({});`,
        ),
      ).toEqual([]);
      expect(
        registrationOwnerViolations(
          join(ROOT, file!),
          `${imported} export const surprise = register({});`,
        ),
      ).not.toEqual([]);
      expect(
        registrationOwnerViolations(
          join(ROOT, file!),
          `${imported} export const ${owner} = register;`,
        ),
      ).not.toEqual([]);
      const wrongBuilder =
        builder === "queryGeneric" ? "mutationGeneric" : "queryGeneric";
      expect(
        registrationOwnerViolations(
          join(ROOT, file!),
          `${imported.replaceAll(builder, wrongBuilder)} export const ${owner} = register({});`,
        ),
      ).not.toEqual([]);
      // Even an exact owner may not hand its builder to other modules.
      const source = builder.endsWith("Generic")
        ? "convex/server"
        : "./../_generated/./server";
      for (const text of [
        `export { ${builder} } from "${source}";`,
        `export { ${builder} as register } from "${source}";`,
        `export * from "${source}";`,
      ])
        expect(
          registrationOwnerViolations(join(ROOT, file!), text),
        ).not.toEqual([]);
    }
  });

  it.each([
    'import "@/lib/navigationGuard";',
    'export { guard } from "../navigationGuard";',
    'const later = import("../navigationGuard");',
    'const guard = require("../navigationGuard");',
    'import { type Guard, guard } from "../navigationGuard";',
    'import { type Guard } from "../navigationGuard";',
    'export { type Guard } from "../navigationGuard";',
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
    'export type { Guard } from "../navigationGuard";',
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
      { specifier: "../_generated/dataModel", typeOnly: false },
      { specifier: "./local", typeOnly: false },
      { specifier: "../lib/tenantTable", typeOnly: false },
      { specifier: "react", typeOnly: false, indirect: true },
      { specifier: "convex/server", typeOnly: true, indirect: true },
    ]);
    expect(resolved(probe, "../lib/tenantTable")).toBe(
      join(ROOT, "convex", "lib", "tenantTable"),
    );
    expect(resolved(probe, "convex/values")).toBeNull();
  });
});
