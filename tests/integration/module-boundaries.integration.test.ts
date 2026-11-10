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
        typeOnly: node.isTypeOnly,
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, typeOnly: false });
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
    // Type-only edges vanish at runtime; a value cycle makes module
    // initialization order observable.
    const files = sourceFiles(SRC);
    const known = new Set(files.map(withoutExtension));
    const edges = new Map<string, string[]>();
    for (const file of files) {
      const from = withoutExtension(file);
      edges.set(
        from,
        importsOf(file).flatMap(({ specifier, typeOnly }) => {
          if (typeOnly) return [];
          const target = resolved(file, specifier);
          if (target === null) return [];
          const candidate = [target, join(target, "index")].find((path) =>
            known.has(path),
          );
          return candidate === undefined ? [] : [candidate];
        }),
      );
    }
    const watched = [
      "src/lib/navigationGuard",
      "src/lib/browser/appHistory",
      "src/lib/browser/appHistoryMarkers",
      "src/lib/browser/history",
    ].map((path) => join(ROOT, path));
    const cycles: string[] = [];
    for (const start of watched) {
      // Depth-first search for a path that returns to `start`.
      const stack: { node: string; path: string[] }[] = [
        { node: start, path: [start] },
      ];
      const seen = new Set<string>();
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
    expect(cycles).toEqual([]);
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
