// T03: resolved dependency graph (pnpm-lock.yaml v9 and candidate bun.lock v3).
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  compareInstalled,
  installedGraph,
} from "../../scripts/ci/installed-graph.mjs";
import {
  allSimplePaths,
  bunGraph,
  compareGraphs,
  declaredRangeProblems,
  graphProblems,
  loadPnpmScope,
  overrideProblems,
  parseBunLockText,
  parseOverrideKey,
  parseRestrictedYaml,
  platformProblems,
  pnpmAuditTreePaths,
  pnpmGraph,
  reachability,
  rootPinProblems,
  scopeReport,
} from "../../scripts/ci/lockfile-graph.mjs";
import {
  compareVersions,
  parseVersion,
  satisfies,
} from "../../scripts/ci/semver-range.mjs";

const integrity = (seed: string) =>
  `sha512-${createHash("sha512").update(seed).digest("base64")}`;

type Meta = Record<string, unknown>;
/** bun.lock v3 object; `entries` maps key → [id, meta]. */
const bunLock = (
  entries: Record<string, [string, Meta?, string?]>,
  workspace: Record<string, Record<string, string>>,
  overrides?: Record<string, unknown>,
) => ({
  lockfileVersion: 3,
  workspaces: { "": { name: "fixture", ...workspace } },
  ...(overrides ? { overrides } : {}),
  packages: Object.fromEntries(
    Object.entries(entries).map(([key, [id, meta = {}, sum]]) => [
      key,
      [id, "", meta, sum ?? integrity(id)],
    ]),
  ),
});
const graph = (lock: unknown) => bunGraph(lock, { scope: "app" });
const paths = (g: ReturnType<typeof graph>, name: string) =>
  allSimplePaths(g, (node: { name: string }) => node.name === name);

/** pnpm v9 lock text for a small graph (`snapshots` drive the edges). */
function pnpmLockText({
  overrides = {} as Record<string, string>,
  deps = {} as Record<string, string>,
  dev = {} as Record<string, string>,
  packages = {} as Record<string, string[]>,
  snapshots = {} as Record<string, Record<string, string>>,
}) {
  const block = (title: string, rows: Record<string, string>) =>
    Object.keys(rows).length
      ? [
          `    ${title}:`,
          ...Object.entries(rows).flatMap(([name, version]) => [
            `      ${name}:`,
            `        specifier: ${version.replace(/\(.*$/, "")}`,
            `        version: ${version}`,
          ]),
        ]
      : [];
  return [
    "lockfileVersion: '9.0'",
    "",
    "settings:",
    "  autoInstallPeers: true",
    "  excludeLinksFromLockfile: false",
    "",
    ...(Object.keys(overrides).length
      ? [
          "overrides:",
          ...Object.entries(overrides).map(([k, v]) => `  ${k}: ${v}`),
          "",
        ]
      : []),
    "importers:",
    "",
    "  .:",
    ...block("dependencies", deps),
    ...block("devDependencies", dev),
    "",
    "packages:",
    "",
    ...Object.entries(packages).flatMap(([key, extra]) => [
      `  ${key}:`,
      `    resolution: {integrity: ${integrity(key)}}`,
      ...extra.map((line) => `    ${line}`),
      "",
    ]),
    "snapshots:",
    "",
    ...Object.entries(snapshots).flatMap(([key, edges]) =>
      Object.keys(edges).length
        ? [
            `  ${key}:`,
            "    dependencies:",
            ...Object.entries(edges).map(([n, v]) => `      ${n}: ${v}`),
            "",
          ]
        : [`  ${key}: {}`, ""],
    ),
  ].join("\n");
}

describe("restricted YAML and lock schemas fail closed", () => {
  it("parses the pnpm subset and rejects unsupported YAML", () => {
    expect(
      parseRestrictedYaml(
        "a:\n  'b@1': {integrity: x, cpu: arm64}\n  c:\n    - d\n  os: [linux, darwin]\n",
      ),
    ).toEqual({
      a: {
        "b@1": { integrity: "x", cpu: "arm64" },
        c: ["d"],
        os: ["linux", "darwin"],
      },
    });
    for (const text of [
      "a: &x 1\n",
      "a:\n\tb: 1\n",
      "a: 1\na: 2\n",
      "a: |\n  x\n",
      "a: {b: {c: 1}}\n",
      "a: {b: [c]}\n",
      " a: 1\n",
    ])
      expect(() => parseRestrictedYaml(text)).toThrow();
  });

  it("rejects unsupported lock versions, importers and bun.lock syntax", () => {
    expect(() => pnpmGraph({ lockfileVersion: "6.0" })).toThrow(/Unsupported/);
    expect(() =>
      pnpmGraph({ lockfileVersion: "9.0", importers: { ".": {}, web: {} } }),
    ).toThrow(/one pnpm importer/);
    expect(() => bunGraph({ lockfileVersion: 2 })).toThrow(/Unsupported/);
    expect(() =>
      bunGraph({
        lockfileVersion: 3,
        workspaces: { "": {}, "packages/a": {} },
      }),
    ).toThrow(/one bun.lock workspace/);
    expect(() => parseBunLockText('{"a": 1 // x\n}')).toThrow(/comments/);
    expect(parseBunLockText('{"a": [1, 2,], "b": "x,}",\n}')).toEqual({
      a: [1, 2],
      b: "x,}",
    });
    const g = graph(
      bunLock(
        { a: ["a@github:owner/a"], b: ["b@1.0.0"] },
        { dependencies: { a: "github:owner/a", b: "1.0.0" } },
      ),
    );
    expect(graphProblems(g)).toEqual(
      expect.arrayContaining(["a: unsupported bun.lock package entry"]),
    );
  });
});

describe("aliases and peer-qualified snapshots", () => {
  it("resolves pnpm aliases and peer-qualified snapshot IDs to real packages", () => {
    const lock = parseRestrictedYaml(
      pnpmLockText({
        deps: { parent: "1.0.0(peer@3.0.0)", peer: "3.0.0" },
        packages: {
          "parent@1.0.0": ["peerDependencies:", "  peer: ^3.0.0"],
          "peer@3.0.0": [],
          "leaf@2.0.0": [],
        },
        snapshots: {
          "parent@1.0.0(peer@3.0.0)": {
            "leaf-alias": "leaf@2.0.0",
            peer: "3.0.0",
          },
          "peer@3.0.0": {},
          "leaf@2.0.0": {},
        },
      }),
    );
    const g = pnpmGraph(lock);
    expect(graphProblems(g)).toEqual([]);
    expect(g.nodes.get("parent@1.0.0(peer@3.0.0)")).toMatchObject({
      name: "parent",
      key: "parent@1.0.0",
    });
    expect(g.edges.get("parent@1.0.0(peer@3.0.0)")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alias: "leaf-alias", target: "leaf@2.0.0" }),
      ]),
    );
    expect(paths(g, "leaf").map((p: { path: string }) => p.path)).toEqual([
      ".>parent>leaf",
    ]);
  });

  it("checks bun npm: aliases against the real package and resolves nested keys first", () => {
    const lock = bunLock(
      {
        parent: [
          "parent@1.0.0",
          { dependencies: { "leaf-alias": "npm:leaf@2.0.0", leaf: "1.0.0" } },
        ],
        "leaf-alias": ["leaf@2.0.0"],
        leaf: ["leaf@3.0.0"],
        "parent/leaf": ["leaf@1.0.0"],
      },
      { dependencies: { parent: "1.0.0", leaf: "3.0.0" } },
    );
    const g = graph(lock);
    expect(graphProblems(g)).toEqual([]);
    expect(g.edges.get("parent")).toEqual([
      expect.objectContaining({ alias: "leaf-alias", target: "leaf-alias" }),
      expect.objectContaining({ alias: "leaf", target: "parent/leaf" }),
    ]);
    lock.packages["leaf-alias"][0] = "impostor@2.0.0";
    expect(graphProblems(graph(lock))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expected package leaf"),
      ]),
    );
  });

  it("requires peers unless declared optional", () => {
    const meta = {
      peerDependencies: { react: "^19", color: "*" },
      optionalPeers: ["color"],
    };
    const missing = graph(
      bunLock({ ui: ["ui@1.0.0", meta] }, { dependencies: { ui: "1.0.0" } }),
    );
    expect(graphProblems(missing)).toEqual([
      "ui -> react: unresolved peerDependencies edge",
    ]);
    const present = graph(
      bunLock(
        { ui: ["ui@1.0.0", meta], react: ["react@19.2.8"] },
        { dependencies: { ui: "1.0.0", react: "19.2.8" } },
      ),
    );
    expect(graphProblems(present)).toEqual([]);
    expect(present.edges.get("ui")).toEqual([
      expect.objectContaining({ alias: "react", kind: "peerDependencies" }),
    ]);
  });
});

describe("unresolved IDs, integrity and incomplete inventories", () => {
  it("reports dangling pnpm snapshots, records and unsupported resolutions", () => {
    const lock = parseRestrictedYaml(
      pnpmLockText({
        deps: { a: "1.0.0" },
        packages: { "a@1.0.0": [], "orphan@1.0.0": [] },
        snapshots: { "a@1.0.0": { missing: "9.9.9" }, "ghost@1.0.0": {} },
      }),
    );
    expect(graphProblems(pnpmGraph(lock))).toEqual(
      expect.arrayContaining([
        "a@1.0.0 -> missing@9.9.9: unresolved edge",
        "ghost@1.0.0: snapshot has no package record",
        "orphan@1.0.0: package record has no snapshot",
      ]),
    );
    lock.packages["a@1.0.0"].resolution = { tarball: "https://x.test/a.tgz" };
    expect(graphProblems(pnpmGraph(lock))).toEqual(
      expect.arrayContaining(["a@1.0.0: unsupported resolution (tarball)"]),
    );
  });

  it("reports unresolved bun edges, missing/invalid/conflicting integrity and unreachable entries", () => {
    const lock = bunLock(
      {
        a: ["a@1.0.0", { dependencies: { gone: "1.0.0" } }, ""],
        b: ["b@1.0.0", {}, "sha1-abc"],
        "a/c": ["c@1.0.0"],
        c: ["c@1.0.0", {}, integrity("different")],
        stray: ["stray@1.0.0"],
      },
      { dependencies: { a: "1.0.0", b: "1.0.0", c: "1.0.0" } },
    );
    expect(graphProblems(graph(lock))).toEqual(
      expect.arrayContaining([
        "a -> gone: unresolved dependencies edge",
        "a@1.0.0: missing or invalid sha512 integrity",
        "b@1.0.0: missing or invalid sha512 integrity",
        "c@1.0.0: conflicting integrity values",
        "stray: lock entry is not reachable from any root",
        "a/c: lock entry is not reachable from any root",
      ]),
    );
  });
});

describe("cycles, multiple routes and dev/prod reachability", () => {
  const lock = bunLock(
    {
      app: ["app@1.0.0", { dependencies: { shared: "1.0.0", mid: "1.0.0" } }],
      mid: ["mid@1.0.0", { dependencies: { shared: "1.0.0" } }],
      shared: ["shared@1.0.0", { dependencies: { loop: "1.0.0" } }],
      loop: ["loop@1.0.0", { dependencies: { shared: "1.0.0" } }],
      tool: [
        "tool@1.0.0",
        { dependencies: { shared: "1.0.0", devonly: "1.0.0" } },
      ],
      devonly: ["devonly@1.0.0"],
    },
    { dependencies: { app: "1.0.0" }, devDependencies: { tool: "1.0.0" } },
  );
  const g = graph(lock);

  it("enumerates every simple route once, terminating on cycles", () => {
    expect(graphProblems(g)).toEqual([]);
    expect(paths(g, "shared")).toEqual([
      { path: ".>app>mid>shared", production: true, versions: ["1.0.0"] },
      { path: ".>app>shared", production: true, versions: ["1.0.0"] },
      { path: ".>tool>shared", production: false, versions: ["1.0.0"] },
    ]);
    expect(paths(g, "loop").map((p: { path: string }) => p.path)).toEqual([
      ".>app>mid>shared>loop",
      ".>app>shared>loop",
      ".>tool>shared>loop",
    ]);
  });

  it("marks shared packages reachable from both production and development", () => {
    const { production, development } = reachability(g);
    expect(production.has("shared") && development.has("shared")).toBe(true);
    expect(production.has("devonly")).toBe(false);
    expect(development.has("devonly")).toBe(true);
  });

  it("refuses to truncate path enumeration", () => {
    expect(() =>
      allSimplePaths(g, (node: { name: string }) => node.name === "shared", {
        maxPaths: 2,
      }),
    ).toThrow(/refusing to truncate/);
  });

  it("reproduces pnpm 10.33.2's one-path-per-snapshot audit tree", () => {
    const pnpmLock = parseRestrictedYaml(
      pnpmLockText({
        deps: { app: "1.0.0" },
        dev: { tool: "1.0.0" },
        packages: {
          "app@1.0.0": [],
          "mid@1.0.0": [],
          "shared@1.0.0": [],
          "tool@1.0.0": [],
        },
        snapshots: {
          "app@1.0.0": { mid: "1.0.0", shared: "1.0.0" },
          "mid@1.0.0": { shared: "1.0.0" },
          "shared@1.0.0": {},
          "tool@1.0.0": { shared: "1.0.0" },
        },
      }),
    );
    expect(paths(pnpmGraph(pnpmLock), "shared")).toHaveLength(3);
    // Dev roots first, then siblings claim a snapshot before descent.
    expect(pnpmAuditTreePaths(pnpmLock).get("shared@1.0.0")).toEqual([
      ".>tool>shared",
    ]);
    expect(
      pnpmAuditTreePaths(pnpmLock, { includeDev: false }).get("shared@1.0.0"),
    ).toEqual([".>app>shared"]);
  });
});

describe("platform-constrained optional/native packages", () => {
  const lock = bunLock(
    {
      host: [
        "host@1.0.0",
        {
          optionalDependencies: {
            "bin-darwin-arm64": "1.0.0",
            "bin-linux-x64": "1.0.0",
            "bin-any-but-aix": "1.0.0",
          },
        },
      ],
      "bin-darwin-arm64": [
        "bin-darwin-arm64@1.0.0",
        { os: "darwin", cpu: "arm64" },
      ],
      "bin-linux-x64": ["bin-linux-x64@1.0.0", { os: "linux", cpu: "x64" }],
      "bin-any-but-aix": ["bin-any-but-aix@1.0.0", { os: ["!aix"] }],
    },
    { dependencies: { host: "1.0.0" } },
  );
  const g = graph(lock);

  it("accepts exactly the platform-compatible installed set", () => {
    const installed = new Set([
      "host@1.0.0",
      "bin-darwin-arm64@1.0.0",
      "bin-any-but-aix@1.0.0",
    ]);
    expect(
      platformProblems(g, installed, { os: "darwin", cpu: "arm64" }),
    ).toEqual([]);
  });

  it("rejects an incompatible install, a missing compatible one and an unknown package", () => {
    const installed = new Set([
      "host@1.0.0",
      "bin-linux-x64@1.0.0",
      "mystery@1.0.0",
    ]);
    expect(
      platformProblems(g, installed, { os: "darwin", cpu: "arm64" }),
    ).toEqual(
      expect.arrayContaining([
        "bin-linux-x64@1.0.0: installed on darwin/arm64 despite os/cpu constraint",
        "mystery@1.0.0: installed but not in the lock",
        "bin-darwin-arm64@1.0.0: platform-compatible lock entry not installed",
        "bin-any-but-aix@1.0.0: platform-compatible lock entry not installed",
      ]),
    );
  });

  it("flags rewritten os/cpu metadata (Bun writes `none` for unknown values)", () => {
    const rewritten = structuredClone(lock);
    rewritten.packages["bin-linux-x64"][2] = { os: "linux", cpu: "none" };
    expect(
      compareGraphs(g, graph(rewritten)).differences.platformMismatches,
    ).toEqual(["bin-linux-x64@1.0.0"]);
  });
});

describe("security overrides against actual resolved parent edges", () => {
  it("parses selector, parent and parent-range keys; rejects deep or empty forms", () => {
    expect(parseOverrideKey("js-yaml@>=4.0.0 <4.3.2")).toMatchObject({
      parent: null,
      child: "js-yaml",
      childRange: ">=4.0.0 <4.3.2",
    });
    expect(parseOverrideKey("next>sharp")).toMatchObject({
      parent: "next",
      child: "sharp",
      childRange: null,
    });
    expect(parseOverrideKey("@vercel/node>undici")).toMatchObject({
      parent: "@vercel/node",
      child: "undici",
    });
    expect(parseOverrideKey("webpack@^4>terser@4")).toMatchObject({
      parent: "webpack",
      parentRange: "^4",
      child: "terser",
      childRange: "4",
    });
    expect(() => parseOverrideKey("a>b>c")).toThrow(/one parent level/);
    expect(() => parseOverrideKey("pkg@")).toThrow(/empty version selector/);
  });

  const lock = bunLock(
    {
      next: [
        "next@16.3.8",
        { dependencies: { sharp: "^0.34.0", postcss: "8.4.31" } },
      ],
      "next/sharp": ["sharp@0.35.5"],
      sharp: ["sharp@0.34.1"],
      "next/postcss": ["postcss@8.5.25"],
      lint: ["lint@1.0.0", { dependencies: { "brace-expansion": "^1.1.7" } }],
      "brace-expansion": ["brace-expansion@1.1.20"],
    },
    {
      dependencies: { next: "16.3.8", sharp: "0.34.1" },
      devDependencies: { lint: "1.0.0" },
    },
  );
  const policy = {
    "next>sharp": "0.35.5",
    "next>postcss": "8.5.25",
    "brace-expansion@>=1.0.0 <1.1.20": "1.1.20",
  };

  it("passes when each scoped override governs exactly its parent edge", () => {
    const result = overrideProblems(graph(lock), policy);
    expect(result.problems).toEqual([]);
    expect(result.applied).toEqual({
      "next>sharp": 1,
      "next>postcss": 1,
      "brace-expansion@>=1.0.0 <1.1.20": 1,
    });
    expect(declaredRangeProblems(graph(lock), policy).problems).toEqual([]);
  });

  it("rejects a parent edge that missed its override and a range-qualified mismatch", () => {
    const drift = structuredClone(lock);
    drift.packages["next/sharp"][0] = "sharp@0.34.5";
    drift.packages["brace-expansion"][0] = "brace-expansion@1.1.19";
    const result = overrideProblems(graph(drift), policy);
    expect(result.problems).toEqual([
      "next>sharp: next@16.3.8>sharp@0.34.5 resolved 0.34.5, override requires 0.35.5",
      "brace-expansion@>=1.0.0 <1.1.20: lint@1.0.0>brace-expansion@1.1.19 is still inside the overridden range",
    ]);
  });

  it("rejects floating override values and reports inactive overrides", () => {
    const result = overrideProblems(graph(lock), {
      sharp: "^0.35.0",
      "left-pad": "1.3.0",
    });
    expect(result.problems).toEqual([
      "sharp: override value ^0.35.0 is not an exact version",
    ]);
    expect(result.inactive).toEqual(["left-pad"]);
  });

  it("rejects resolved versions outside the declared range unless an override explains them", () => {
    const unexplained = declaredRangeProblems(graph(lock), {});
    expect(unexplained.problems).toEqual([
      "next@16.3.8 -> sharp@0.35.5: outside declared ^0.34.0",
      "next@16.3.8 -> postcss@8.5.25: outside declared 8.4.31",
    ]);
  });

  it("preserves exact root pins", () => {
    const g = graph(lock);
    expect(
      rootPinProblems(g, {
        dependencies: { next: "16.3.8", sharp: "0.34.1" },
        devDependencies: { lint: "1.0.0" },
      }),
    ).toEqual([]);
    expect(
      rootPinProblems(g, {
        dependencies: { next: "^16.3.8", sharp: "0.34.2" },
        devDependencies: {},
      }),
    ).toEqual([
      "dependencies.next: ^16.3.8 is not an exact pin",
      "dependencies.next: manifest ^16.3.8, lock 16.3.8 → 16.3.8",
      "dependencies.sharp: manifest 0.34.2, lock 0.34.1 → 0.34.1",
      "devDependencies.lint: in lock but not in manifest",
    ]);
  });
});

describe("pnpm/bun scope parity report", () => {
  const root = mkdtempSync(join(tmpdir(), "t03-graph-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const manifest = {
    name: "fixture",
    dependencies: { a: "1.0.0" },
    devDependencies: { t: "1.0.0" },
  };
  const overrides = { "c@<2.0.0": "2.0.0" };
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    "overrides:\n  c@<2.0.0: 2.0.0\n",
  );
  writeFileSync(
    join(root, "pnpm-lock.yaml"),
    pnpmLockText({
      overrides,
      deps: { a: "1.0.0" },
      dev: { t: "1.0.0" },
      packages: { "a@1.0.0": [], "b@1.0.0": [], "c@2.0.0": [], "t@1.0.0": [] },
      snapshots: {
        "a@1.0.0": { b: "1.0.0", c: "2.0.0" },
        "b@1.0.0": {},
        "c@2.0.0": {},
        "t@1.0.0": { b: "1.0.0" },
      },
    }),
  );
  const candidate = (cVersion: string, { omitTrust = false } = {}) => {
    const dir = mkdtempSync(join(root, "bun-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        ...manifest,
        overrides,
        ...(omitTrust ? {} : { trustedDependencies: [] }),
      }),
    );
    const lock = bunLock(
      {
        a: [
          "a@1.0.0",
          { dependencies: { b: "1.0.0", c: "^1.5.0" } },
          integrity("a@1.0.0"),
        ],
        b: ["b@1.0.0", {}, integrity("b@1.0.0")],
        c: [`c@${cVersion}`, {}, integrity(`c@${cVersion}`)],
        t: ["t@1.0.0", { dependencies: { b: "1.0.0" } }, integrity("t@1.0.0")],
      },
      { dependencies: { a: "1.0.0" }, devDependencies: { t: "1.0.0" } },
      { "c@<2.0.0": { ".": "2.0.0" } },
    );
    writeFileSync(
      join(dir, "bun.lock"),
      JSON.stringify(lock, null, 2).replace(/\n(\s*)([}\]])/g, ",\n$1$2"),
    );
    return dir;
  };

  it("passes for an equivalent migrated graph", () => {
    const report = scopeReport("app", candidate("2.0.0"), {
      repositoryRoot: root,
      packageName: "b",
    });
    expect(report.problems).toEqual([]);
    expect(
      report.paths.bunAllSimple.map((p: { path: string }) => p.path),
    ).toEqual([".>a>b", ".>t>b"]);
  });

  it("treats a migrated version mismatch as a blocker, never an upgrade", () => {
    const report = scopeReport("app", candidate("1.9.0"), {
      repositoryRoot: root,
      packageName: "b",
    });
    expect(report.problems).toEqual(
      expect.arrayContaining([
        "bun override: c@<2.0.0: a@1.0.0>c@1.9.0 is still inside the overridden range",
        expect.stringMatching(
          /^graph parity: packagesOnlyInBaseline: 1 \(c@2\.0\.0\)/,
        ),
      ]),
    );
  });

  it("requires explicit empty trust and an existing frozen lock", () => {
    expect(
      scopeReport("app", candidate("2.0.0", { omitTrust: true }), {
        repositoryRoot: root,
        packageName: "b",
      }).problems,
    ).toContain(
      "bun: candidate package.json must declare trustedDependencies: []",
    );
    const empty = mkdtempSync(join(root, "nolock-"));
    expect(() => scopeReport("app", empty, { repositoryRoot: root })).toThrow(
      /bun.lock does not exist/,
    );
  });
});

describe("installed isolated layout", () => {
  const dir = mkdtempSync(join(tmpdir(), "t03-installed-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const pkg = (
    store: string,
    entry: string,
    name: string,
    version: string,
    links: Record<string, string> = {},
  ) => {
    const modules = join(
      dir,
      store,
      "node_modules",
      ".bun",
      entry,
      "node_modules",
    );
    mkdirSync(join(modules, name), { recursive: true });
    writeFileSync(
      join(modules, name, "package.json"),
      JSON.stringify({ name, version }),
    );
    for (const [alias, target] of Object.entries(links))
      symlinkSync(
        join("..", "..", target, "node_modules", alias),
        join(modules, alias),
      );
  };

  it("reads real link targets, merges peer variants and finds extra edges", () => {
    pkg("a", "debug@4.4.3", "debug", "4.4.3", { ms: "ms@2.1.3" });
    pkg("a", "ms@2.1.3", "ms", "2.1.3");
    pkg("b", "debug@4.4.3+peer", "debug", "4.4.3", {
      ms: "ms@2.1.3",
      "supports-color": "supports-color@8.1.1",
    });
    pkg("b", "ms@2.1.3", "ms", "2.1.3");
    pkg("b", "supports-color@8.1.1", "supports-color", "8.1.1");
    for (const store of ["a", "b"])
      symlinkSync(
        join(
          ".bun",
          store === "a" ? "debug@4.4.3" : "debug@4.4.3+peer",
          "node_modules",
          "debug",
        ),
        join(dir, store, "node_modules", "debug"),
      );
    const a = installedGraph(join(dir, "a"), "bun");
    const b = installedGraph(join(dir, "b"), "bun");
    expect([...a.edges]).toEqual(["debug@4.4.3 -> ms@2.1.3"]);
    expect(compareInstalled(a, b)).toMatchObject({
      packagesOnlyInCandidate: ["supports-color@8.1.1"],
      edgesOnlyInCandidate: ["debug@4.4.3 -> supports-color@8.1.1"],
      rootsOnlyInCandidate: [],
    });
  });

  it("fails closed on dangling links and missing stores", () => {
    pkg("c", "x@1.0.0", "x", "1.0.0", { y: "y@1.0.0" });
    expect(() => installedGraph(join(dir, "c"), "bun")).toThrow();
    expect(() => installedGraph(join(dir, "missing"), "bun")).toThrow(
      /does not exist/,
    );
    expect(() => installedGraph(join(dir, "a"), "npm")).toThrow(
      /Unknown package manager/,
    );
  });
});

describe("current repository graphs (authoritative pnpm locks)", () => {
  it.each(["app", "release"] as const)(
    "%s: complete, pinned and every override active on real edges",
    (scope) => {
      const { graph: g, manifest, workspace, lock } = loadPnpmScope(scope);
      expect(graphProblems(g)).toEqual([]);
      expect(rootPinProblems(g, manifest)).toEqual([]);
      expect(lock.overrides).toEqual(workspace.overrides);
      const result = overrideProblems(g, workspace.overrides);
      expect(result.problems).toEqual([]);
      // @fastify/busboy is no longer in the release graph; recorded, not removed.
      expect(result.inactive).toEqual(
        scope === "release" ? ["@fastify/busboy@>=1.0.0 <3.2.1"] : [],
      );
    },
  );

  it.each(["app", "release"] as const)(
    "%s: braces chains vs the single excepted path",
    (scope) => {
      const { graph: g } = loadPnpmScope(scope);
      const braces = paths(g, "braces");
      expect(braces.length).toBeGreaterThan(1);
      expect(
        braces.every(
          (p: { versions: string[] }) => p.versions.join() === "3.0.3",
        ),
      ).toBe(true);
      // App chains are development-only; every release chain is production.
      expect(
        braces.every(
          (p: { production: boolean }) =>
            p.production === (scope === "release"),
        ),
      ).toBe(true);
    },
  );
});

describe("semver ranges used by advisories and override selectors", () => {
  it("matches node-semver semantics for the ranges in use", () => {
    const cases: [string, string, boolean][] = [
      ["3.0.3", "<=3.0.3", true],
      ["3.0.4", "<=3.0.3", false],
      ["8.6.3", ">=7.0.0-alpha.0 <8.18.0", true],
      ["7.0.0-alpha.1", ">=7.0.0-alpha.0 <8.18.0", true],
      ["7.1.0-beta.1", ">=7.0.0-alpha.0 <8.18.0", false],
      ["1.1.20", ">=1.0.0 <1.1.20", false],
      ["0.1.9", "^0.1.0", true],
      ["0.2.0", "^0.1.0", false],
      ["19.2.8", "^18.0.0 || ~19.0.3 || ~19.2.3", true],
      ["2.5.0", "1.2 - 3", true],
      ["1.9.9", ">= 1.2", true],
    ];
    for (const [version, range, expected] of cases)
      expect(satisfies(version, range)).toBe(expected);
    expect(compareVersions("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
  });

  it("throws on unsupported ranges and versions instead of guessing", () => {
    for (const range of ["latest", "github:a/b", ">=1.0.0 <", "1.2.3.4"])
      expect(() => satisfies("1.0.0", range)).toThrow();
    expect(() => parseVersion("1.0")).toThrow();
  });
});
