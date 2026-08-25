import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  pickMessages,
  ROUTE_NAMESPACES,
  SHELL_NAMESPACES,
  type MessageNamespace,
} from "./clientMessages";
import { ALL_CATALOGUES } from "./messages";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");
const APP = join(SRC, "app", "[locale]");

function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      out.push(path);
  }
  return out;
}

interface Module {
  readonly isClientEntry: boolean;
  readonly imports: readonly string[];
  readonly namespaces: readonly MessageNamespace[];
}

function resolveImport(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return undefined; // A package; it cannot reach a catalogue namespace.

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

const modules = new Map<string, Module>();
const nonLiteralNamespaces: string[] = [];

for (const file of sourceFiles(SRC)) {
  const source = readFileSync(file, "utf8");
  const imports: string[] = [];

  for (const match of source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
  ))
    imports.push(match[1] ?? "");
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g))
    imports.push(match[1] ?? "");

  const namespaces: MessageNamespace[] = [];
  let literalCalls = 0;
  for (const match of source.matchAll(
    /\buseTranslations\(\s*["']([^"']+)["']/g,
  )) {
    literalCalls += 1;
    namespaces.push(match[1] as MessageNamespace);
  }
  // Every call must have been matched with a literal; anything left over is a
  // namespace this walk cannot see, and therefore cannot guard.
  const allCalls = [...source.matchAll(/\buseTranslations\(/g)].length;
  if (allCalls !== literalCalls)
    nonLiteralNamespaces.push(relative(REPO, file));

  modules.set(file, {
    isClientEntry: /^\s*(["'])use client\1/m.test(source.slice(0, 400)),
    imports: imports
      .map((specifier) => resolveImport(file, specifier))
      .filter((path): path is string => path !== undefined),
    namespaces,
  });
}

function clientNamespaces(entries: readonly string[]): ReadonlySet<string> {
  const found = new Set<string>();
  const seen = new Set<string>();
  const stack: Array<readonly [string, boolean]> = entries.map((entry) => [
    entry,
    false,
  ]);

  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    const [file, inheritedClient] = next;
    const current = modules.get(file);
    if (current === undefined) continue;

    const isClient = inheritedClient || current.isClientEntry;
    const key = `${file}|${isClient}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (isClient)
      for (const namespace of current.namespaces) found.add(namespace);
    for (const dependency of current.imports)
      stack.push([dependency, isClient]);
  }
  return found;
}

const routeEntries = sourceFiles(APP).filter((file) =>
  /(?:^|\/)(page|not-found)\.tsx$/.test(file.split(sep).join("/")),
);

const scopeOf = (file: string): string | undefined =>
  Object.keys(ROUTE_NAMESPACES).find((scope) =>
    file.startsWith(join(APP, scope) + sep),
  );

const sorted = (values: Iterable<string>): readonly string[] =>
  [...values].sort();

const bytes = (namespaces: Iterable<string>, locale: "en" | "th"): number => {
  const catalogue = ALL_CATALOGUES[locale] as Record<string, unknown>;
  return Buffer.byteLength(
    JSON.stringify(
      Object.fromEntries([...namespaces].map((n) => [n, catalogue[n]])),
    ),
    "utf8",
  );
};

const FULL_TH = Buffer.byteLength(JSON.stringify(ALL_CATALOGUES.th), "utf8");

const TERMINAL_INBOUND = [
  "(desktop)/quality",
  "(desktop)/putaway",
  "(handheld)/handheld/quality",
  "(handheld)/handheld/putaway",
] as const;

describe("client message namespaces", () => {
  it("names every namespace with a string literal", () => {
    expect(nonLiteralNamespaces).toEqual([]);
  });

  it("resolves the source graph it is about to assert on", () => {
    expect(modules.size).toBeGreaterThan(100);
    expect(routeEntries.length).toBeGreaterThan(20);
    expect(
      sorted(clientNamespaces([join(APP, "(desktop)", "layout.tsx")])),
    ).toEqual(sorted(SHELL_NAMESPACES.filter((name) => name !== "Error")));
    expect(sorted(clientNamespaces([join(APP, "error.tsx")]))).toEqual([
      "Error",
    ]);
  });

  it("carries exactly the shell chrome in the root provider", () => {
    // The union of both shells, because the root layout is above both of them.
    const required = new Set([
      ...clientNamespaces([join(APP, "layout.tsx")]),
      ...clientNamespaces([join(APP, "error.tsx")]),
      ...clientNamespaces([join(APP, "(desktop)", "layout.tsx")]),
      ...clientNamespaces([join(APP, "(handheld)", "layout.tsx")]),
    ]);
    expect(sorted(SHELL_NAMESPACES)).toEqual(sorted(required));
  });

  it.each(Object.keys(ROUTE_NAMESPACES))(
    "declares exactly what %s reaches",
    (scope) => {
      const pages = routeEntries.filter((file) => scopeOf(file) === scope);
      expect(pages.length).toBeGreaterThan(0);

      const required = clientNamespaces(pages);
      const declared = ROUTE_NAMESPACES[scope as keyof typeof ROUTE_NAMESPACES];
      expect(sorted(declared)).toEqual(sorted(required));
    },
  );

  it("mounts every scope from a layout inside that scope, and only there", () => {
    const declared = new Set(Object.keys(ROUTE_NAMESPACES));
    const mounted = new Map<string, string>();

    for (const file of sourceFiles(APP)) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /<RouteMessages\s+scope="([^"]+)"/g,
      )) {
        const scope = match[1] ?? "";
        expect(declared).toContain(scope);

        expect(relative(REPO, file)).toContain(scope.split("/").join(sep));
        expect(mounted.has(scope)).toBe(false);
        mounted.set(scope, file);
      }
    }
    expect(sorted(mounted.keys())).toEqual(sorted(declared));
  });

  it("leaves no route outside a scope needing more than the shell", () => {
    const shell = new Set<string>(SHELL_NAMESPACES);
    for (const file of routeEntries) {
      if (scopeOf(file) !== undefined) continue;
      const required = clientNamespaces([file]);
      expect({
        route: relative(APP, file),
        extra: sorted([...required].filter((n) => !shell.has(n))),
      }).toEqual({ route: relative(APP, file), extra: [] });
    }
  });

  it("never hands a provider the whole catalogue", () => {
    const all = Object.keys(ALL_CATALOGUES.th);
    for (const [scope, namespaces] of Object.entries(ROUTE_NAMESPACES)) {
      expect(
        { scope, count: namespaces.length < all.length },
        `${scope} declares every namespace there is`,
      ).toEqual({ scope, count: true });
    }
    expect(SHELL_NAMESPACES.length).toBeLessThan(all.length / 4);
  });

  it("keeps each route's Thai payload well under the full catalogue", () => {
    const shellBytes = bytes(SHELL_NAMESPACES, "th");
    expect(shellBytes).toBeLessThan(6_250);

    for (const [scope, namespaces] of Object.entries(ROUTE_NAMESPACES)) {
      const total = shellBytes + bytes(namespaces, "th");
      expect(
        { scope, withinBudget: total < FULL_TH * 0.7 },
        `${scope} ships ${total}B of ${FULL_TH}B`,
      ).toEqual({ scope, withinBudget: true });
    }

    for (const scope of [
      "(auth)/sign-in",
      "(desktop)/dashboard",
      "(desktop)/inventory",
      "(handheld)/handheld/inventory",
    ] as const) {
      const total = shellBytes + bytes(ROUTE_NAMESPACES[scope], "th");
      expect(
        { scope, small: total < FULL_TH * 0.25 },
        `${scope} ships ${total}B of ${FULL_TH}B`,
      ).toEqual({ scope, small: true });
    }

    for (const scope of TERMINAL_INBOUND) {
      const total = shellBytes + bytes(ROUTE_NAMESPACES[scope], "th");
      expect(
        { scope, small: total < FULL_TH * 0.28 },
        `${scope} ships ${total}B of ${FULL_TH}B`,
      ).toEqual({ scope, small: true });
    }
  });

  it("keeps the shared paging chrome off the inventory vocabulary", () => {
    const CHROME = ["Panel", "Pagination"];
    for (const panel of [
      join(SRC, "features", "inventory", "LedgerPanel.tsx"),
      join(SRC, "features", "masterData", "MasterDataPanel.tsx"),
    ]) {
      const namespaces = modules.get(panel)?.namespaces ?? [];
      expect(
        {
          file: relative(REPO, panel),
          domain: sorted(namespaces.filter((n) => !CHROME.includes(n))),
        },
        "a domain namespace here is paid for by every paged screen",
      ).toEqual({ file: relative(REPO, panel), domain: [] });
    }
  });

  it("declares Inventory only where an inventory screen renders", () => {
    const carriers = Object.entries(ROUTE_NAMESPACES)
      .filter(([, namespaces]) =>
        (namespaces as readonly string[]).includes("Inventory"),
      )
      .map(([scope]) => scope);

    expect(sorted(carriers)).toEqual([
      "(desktop)/inventory",
      "(handheld)/handheld/inventory",
    ]);
  });

  it("keeps quality and putaway off the ordering and receiving catalogues", () => {
    const foreign = [
      "ImportProblem",
      "LabelEvidence",
      "PurchaseOrderLineStatus",
      "PurchaseOrderStatus",
      "Purchasing",
      "ReceiptClassification",
      "ReceiptLineKind",
      "Receiving",
    ];

    for (const scope of TERMINAL_INBOUND) {
      const declared: readonly string[] = ROUTE_NAMESPACES[scope];
      expect({
        scope,
        reaches: sorted(declared.filter((n) => foreign.includes(n))),
      }).toEqual({ scope, reaches: [] });
    }
  });

  it("keeps the modules every inbound screen imports free of translations", () => {
    for (const shared of [
      join(SRC, "features", "inbound", "InboundPrimitives.tsx"),
      join(SRC, "components", "inbound", "InboundCells.tsx"),
    ]) {
      const entry = modules.get(shared);
      expect(
        { file: relative(REPO, shared), namespaces: entry?.namespaces },
        "a namespace here is paid for by every inbound route",
      ).toEqual({ file: relative(REPO, shared), namespaces: [] });
    }
  });

  it("keeps the app's providers from inheriting the catalogue implicitly", () => {
    const users = [...sourceFiles(APP), join(SRC, "i18n", "RouteMessages.tsx")];
    const bare: string[] = [];
    for (const file of users) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /<NextIntlClientProvider([\s\S]*?)>/g,
      )) {
        if (!(match[1] ?? "").includes("messages="))
          bare.push(relative(REPO, file));
      }
    }
    expect(bare).toEqual([]);
  });
});

describe("pickMessages", () => {
  it("returns only the requested namespaces", () => {
    const picked = pickMessages(ALL_CATALOGUES.th, ["Setup", "App"]);

    expect(Object.keys(picked).sort()).toEqual(["App", "Setup"]);
    expect(picked.Setup).toBe(ALL_CATALOGUES.th.Setup);
  });

  it("throws rather than shipping a hole when a namespace is gone", () => {
    expect(() =>
      pickMessages({ App: {} }, ["App", "Setup" as MessageNamespace]),
    ).toThrow(/Setup/);
  });

  it("does not copy the namespaces it was not asked for", () => {
    const picked: Record<string, unknown> = pickMessages(ALL_CATALOGUES.en, [
      "App",
    ]);

    expect(picked["Receiving"]).toBeUndefined();
    expect(picked["MasterData"]).toBeUndefined();
  });
});
