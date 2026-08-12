/**
 * The guard that keeps the message catalogue out of the client payload.
 *
 * Picking namespaces by hand is only safe if something checks the hand. This
 * file derives, from the source itself, which namespaces each route's *client*
 * components reach, and asserts `clientMessages.ts` says exactly that — in both
 * directions:
 *
 * - a namespace the graph needs and the manifest omits would render
 *   `Receiving.title` to an operator, so the test fails;
 * - a namespace the manifest carries and nothing needs is dead weight in every
 *   payload of that subtree, so the test fails too.
 *
 * The derivation is a plain import walk rather than a type-aware pass because
 * every `useTranslations` call in this repository names its namespace with a
 * string literal, and the test asserts that stays true. If someone ever writes
 * `useTranslations(someVariable)`, this file fails loudly instead of quietly
 * under-reporting — which is the failure mode that would matter.
 */
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

/** Every non-test source file, which is the universe the walk resolves within. */
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
  /** Whether the file carries the `"use client"` directive itself. */
  readonly isClientEntry: boolean;
  readonly imports: readonly string[];
  readonly namespaces: readonly MessageNamespace[];
}

/** Resolve an import specifier the way the `@/*` alias and the bundler do. */
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
  // `export ... from` as well as `import ... from`: a re-export is an edge in
  // the bundler's graph exactly like an import is, so a barrel module that
  // forwarded a client component would otherwise be a hole in this walk — and a
  // hole here *under*-reports, which is the direction that ships
  // `Receiving.title` to a warehouse screen rather than merely wasting bytes.
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

/**
 * The namespaces reachable from `entries` through a `"use client"` boundary.
 *
 * A module is visited once per "am I inside client code" state, because the same
 * helper can be imported by a server component (whose translations are rendered
 * away on the server) and by a client one (whose translations must be shipped).
 * Only the client visit contributes.
 */
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

/** Every `page.tsx` and `not-found.tsx` under the locale segment. */
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

/**
 * The inbound workflows that end at a decision rather than hand on to another.
 *
 * An inspection is decided and a pallet is put away; neither screen renders an
 * order, a receipt, or a label. They are named once here because two assertions
 * below depend on that being true of them and not of purchasing or receiving.
 */
const TERMINAL_INBOUND = [
  "(desktop)/quality",
  "(desktop)/putaway",
  "(handheld)/handheld/quality",
  "(handheld)/handheld/putaway",
] as const;

describe("client message namespaces", () => {
  it("names every namespace with a string literal", () => {
    // The walk below reads namespaces syntactically. A computed one would make
    // every assertion here an under-estimate, so it is banned outright.
    expect(nonLiteralNamespaces).toEqual([]);
  });

  it("resolves the source graph it is about to assert on", () => {
    // Guards against the walk silently finding nothing — a resolver regression
    // would otherwise make every "no extra namespaces" assertion pass.
    expect(modules.size).toBeGreaterThan(100);
    expect(routeEntries.length).toBeGreaterThan(20);
    expect(clientNamespaces([join(APP, "(desktop)", "layout.tsx")]).size).toBe(
      SHELL_NAMESPACES.length,
    );
  });

  it("carries exactly the shell chrome in the root provider", () => {
    // The union of both shells, because the root layout is above both of them.
    const required = new Set([
      ...clientNamespaces([join(APP, "layout.tsx")]),
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
        // The provider has to sit inside the subtree it describes, or it would
        // ship those namespaces to routes that never asked for them.
        expect(relative(REPO, file)).toContain(scope.split("/").join(sep));
        expect(mounted.has(scope)).toBe(false);
        mounted.set(scope, file);
      }
    }
    expect(sorted(mounted.keys())).toEqual(sorted(declared));
  });

  it("leaves no route outside a scope needing more than the shell", () => {
    // `/[locale]` (a redirect), `/handheld` (a launcher), and `not-found` render
    // no client translations today. If one ever does, it needs its own scope
    // rather than a quiet addition to the shell that every page would pay for.
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
    // The budget is deliberately loose: it is a floor against regression, not a
    // target. The purchasing and receiving scopes are the largest, because a
    // receipt is posted against an order and those screens genuinely read both
    // vocabularies; everything else is far below this.
    const shellBytes = bytes(SHELL_NAMESPACES, "th");
    expect(shellBytes).toBeLessThan(6_000);

    for (const [scope, namespaces] of Object.entries(ROUTE_NAMESPACES)) {
      const total = shellBytes + bytes(namespaces, "th");
      expect(
        { scope, withinBudget: total < FULL_TH * 0.7 },
        `${scope} ships ${total}B of ${FULL_TH}B`,
      ).toEqual({ scope, withinBudget: true });
    }

    // The screens an operator opens most should be dramatically smaller, not
    // marginally: these are the reason for the whole arrangement.
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

    /*
     * Quality and putaway are held to their own line, because what keeps them
     * there is different: they carry almost nothing but their own vocabulary,
     * and `Putaway` plus its two score namespaces are 4.9 kB on their own. That
     * is the floor those words set, not slack — before the module seam was
     * split these two shipped more than half the catalogue.
     *
     * Putaway is the larger of the pair at 24.5%, so 28% is roughly 2 kB of
     * headroom: enough for the screens to gain wording, tight enough that
     * another namespace arriving through a shared module fails here.
     */
    for (const scope of TERMINAL_INBOUND) {
      const total = shellBytes + bytes(ROUTE_NAMESPACES[scope], "th");
      expect(
        { scope, small: total < FULL_TH * 0.28 },
        `${scope} ships ${total}B of ${FULL_TH}B`,
      ).toEqual({ scope, small: true });
    }
  });

  it("keeps the shared paging chrome off the inventory vocabulary", () => {
    /*
     * `LedgerPanel` and `MasterDataPanel` render the pager for every paged list
     * in the application, inventory screens and master-data screens alike. Both
     * once read their five pager strings from `Inventory`, which is why eight
     * scopes that never show a balance carried the column headings, the
     * captions, and the read-only notice with them — 1.5 kB of Thai each.
     *
     * Stated as a rule rather than as byte counts: a component that renders on
     * every screen may only name chrome namespaces. The exact-match test above
     * would accept `useTranslations("Inventory")` here and simply grow the
     * manifest to suit.
     */
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
    // The consequence of the rule above, checked from the manifest's side: the
    // balances and history screens read the inventory vocabulary, and nothing
    // else in the application does.
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
    /*
     * The seam this file's manifest was reorganised around, asserted as a rule
     * rather than as a list of namespaces.
     *
     * Quality and putaway are terminal inbound workflows: an inspection is
     * decided and a pallet is put away, and neither screen renders an order, a
     * receipt, or a label. They nonetheless carried `Purchasing`, `Receiving`,
     * and `LabelEvidence` — 18.7 kB of Thai between them — because they reached
     * those namespaces through modules they imported for other reasons: a
     * heading, a warehouse gate, a reason-code picker, a paging helper.
     *
     * Restating that as an assertion, rather than trusting the numbers above to
     * be noticed, is the point: the exact-match test would happily accept a
     * regression here, because a regression makes the manifest bigger *and*
     * still true. This is what would make it false.
     */
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
    /*
     * The other half of the seam. `InboundPrimitives` (a heading, a warehouse
     * gate, paging arguments) and `InboundCells` (two value formatters) are
     * imported by every inbound screen in both shells, so a `useTranslations`
     * call added to either would put that namespace back on all of them — which
     * is exactly how the quality and putaway payloads grew the first time.
     */
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
    // `NextIntlClientProvider` with no `messages` prop inherits the entire
    // request configuration. That is the exact regression this file exists to
    // prevent, and it is invisible at the call site, so it is checked textually.
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
    // Every caller runs during static generation, so this fails `next build`
    // instead of rendering a key path onto a warehouse screen.
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
