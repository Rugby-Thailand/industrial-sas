// T03: resolved dependency graph (pnpm-lock.yaml v9 and candidate bun.lock v3).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import { compareResolutionContexts } from "../../scripts/ci/resolution-context.mjs";
import {
  allSimplePaths,
  bunGraph,
  compareGraphs,
  declaredRangeProblems,
  graphProblems,
  loadBunScope,
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
  rangesOverlap,
  isExactVersion,
  satisfies,
} from "../../scripts/ci/semver-range.mjs";

const integrity = (seed: string) =>
  `sha512-${createHash("sha512").update(seed).digest("base64")}`;

type Meta = Record<string, unknown>;
/** A normalized root or edge binding; other recorded fields are retained. */
type Binding = {
  alias: string;
  target: string | null;
  [field: string]: unknown;
};
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
/** Mutable package tuple of a bun.lock fixture (untrusted input data). */
const tuple = (lock: { packages: Record<string, unknown[]> }, key: string) => {
  const row = lock.packages[key];
  if (!row) throw new Error(`bun.lock fixture lacks ${key}`);
  return row;
};
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
      ".>parent>leaf-alias",
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
    tuple(lock, "leaf-alias")[0] = "impostor@2.0.0";
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
    expect(graphProblems(missing)).toEqual(
      expect.arrayContaining(["ui -> react: unresolved peerDependencies edge"]),
    );
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
    tuple(rewritten, "bin-linux-x64")[2] = { os: "linux", cpu: "none" };
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
    tuple(drift, "next/sharp")[0] = "sharp@0.34.5";
    tuple(drift, "brace-expansion")[0] = "brace-expansion@1.1.19";
    const result = overrideProblems(graph(drift), policy);
    expect(result.problems).toEqual([
      "next>sharp: next@16.3.8>sharp@0.34.5 resolved 0.34.5, override requires 0.35.5",
      "brace-expansion@>=1.0.0 <1.1.20: lint@1.0.0>brace-expansion@1.1.19 resolved 1.1.19, override requires 1.1.20",
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

  it("records missing pnpm declared provenance despite equivalent resolution", () => {
    const report = scopeReport("app", candidate("2.0.0"), {
      repositoryRoot: root,
      packageName: "b",
    });
    expect(report.problems).toEqual([
      "pnpm override: c@<2.0.0: a@1.0.0>c@2.0.0: original declared range unavailable; selector applicability unproven",
    ]);
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
        "bun override: c@<2.0.0: a@1.0.0>c@1.9.0 resolved 1.9.0, override requires 2.0.0",
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

  // Top-level decoys precede the real key, so last-key-wins parsing would
  // accept them; the nested duplicate sits in an otherwise unique field.
  const duplicateManifests = [
    ["repeated", '{"trustedDependencies":["esbuild"],"trustedDependencies":[]'],
    [
      "escaped",
      '{"trustedDependencies":["esbuild"],"trusted\\u0044ependencies":[]',
    ],
    ["nested", '{"engines":{"node":">=24","node":">=0"}'],
  ] as const;
  /** A repository root with this scope's pnpm files and the given manifest. */
  const pnpmRepo = (manifestText: string) => {
    const repo = mkdtempSync(join(root, "repo-"));
    for (const file of ["pnpm-lock.yaml", "pnpm-workspace.yaml"])
      writeFileSync(join(repo, file), readFileSync(join(root, file)));
    writeFileSync(join(repo, "package.json"), manifestText);
    return repo;
  };
  const withDecoy = (prefix: string) =>
    `${prefix},${JSON.stringify({ ...manifest, overrides, trustedDependencies: [] }).slice(1)}`;

  it.each(duplicateManifests)(
    "refuses a %s duplicate manifest key in both scope loaders",
    (_label, prefix) => {
      const bun = candidate("2.0.0");
      writeFileSync(join(bun, "package.json"), withDecoy(prefix));
      expect(() => loadBunScope("app", bun)).toThrow(
        "Duplicate JSON object key",
      );
      expect(() =>
        scopeReport("app", bun, { repositoryRoot: root, packageName: "b" }),
      ).toThrow("Duplicate JSON object key");
      expect(() => loadPnpmScope("app", pnpmRepo(withDecoy(prefix)))).toThrow(
        "Duplicate JSON object key",
      );
    },
  );

  it("keeps both loaders' unique-key manifests and refuses non-object roots", () => {
    expect(loadPnpmScope("app", root).manifest).toEqual(manifest);
    expect(loadBunScope("app", candidate("2.0.0")).manifest).toEqual({
      ...manifest,
      overrides,
      trustedDependencies: [],
    });
    for (const text of ["[]", "null", '"fixture"']) {
      const bun = candidate("2.0.0");
      writeFileSync(join(bun, "package.json"), text);
      expect(() => loadBunScope("app", bun)).toThrow(/must be a JSON object/);
      expect(() => loadPnpmScope("app", pnpmRepo(text))).toThrow(
        /must be a JSON object/,
      );
    }
  });

  it.each(duplicateManifests)(
    "lockfile-graph CLI fails closed on a %s duplicate candidate manifest key",
    (_label, prefix) => {
      const bun = candidate("2.0.0");
      writeFileSync(join(bun, "package.json"), withDecoy(prefix));
      const result = spawnSync(
        process.execPath,
        ["scripts/ci/lockfile-graph.mjs", "--scope=app", `--bun-dir=${bun}`],
        {
          encoding: "utf8",
          env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "Graph check failed closed: Duplicate JSON object key",
      );
    },
  );
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
      JSON.stringify({
        name,
        version,
        dependencies: Object.fromEntries(
          Object.entries(links).map(([alias, target]) => [
            alias,
            target.split("@").at(-1),
          ]),
        ),
      }),
    );
    for (const [alias, target] of Object.entries(links))
      symlinkSync(
        join("..", "..", target, "node_modules", alias),
        join(modules, alias),
      );
  };

  it("reads real link targets and preserves contexts while finding extra edges", () => {
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
    const expected = (extra: boolean) =>
      graph(
        bunLock(
          {
            debug: [
              "debug@4.4.3",
              {
                dependencies: {
                  ms: "2.1.3",
                  ...(extra ? { "supports-color": "8.1.1" } : {}),
                },
              },
            ],
            ms: ["ms@2.1.3"],
            ...(extra
              ? { "supports-color": ["supports-color@8.1.1"] as [string] }
              : {}),
          },
          { dependencies: { debug: "4.4.3" } },
        ),
      );
    for (const store of ["a", "b"])
      writeFileSync(
        join(dir, store, "package.json"),
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          dependencies: { debug: "4.4.3" },
        }),
      );
    const a = installedGraph(join(dir, "a"), "bun", {
      expectedGraph: expected(false),
    });
    const b = installedGraph(join(dir, "b"), "bun", {
      expectedGraph: expected(true),
    });
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
    "%s: complete and pinned, but selector provenance remains unproven",
    (scope) => {
      const { graph: g, manifest, workspace, lock } = loadPnpmScope(scope);
      expect(graphProblems(g)).toEqual([]);
      expect(rootPinProblems(g, manifest)).toEqual([]);
      expect(lock.overrides).toEqual(workspace.overrides);
      const result = overrideProblems(g, workspace.overrides);
      expect(result.problems.length).toBeGreaterThan(0);
      expect(
        result.problems.every((problem: string) =>
          problem.includes(
            "original declared range unavailable; selector applicability unproven",
          ),
        ),
      ).toBe(true);
      // The lock's resolved references must never stand in for declared requests.
      expect(
        [...g.edges.values()]
          .flat()
          .filter(
            (edge: { declaredSource: string }) =>
              edge.declaredSource === "unavailable",
          ).length,
      ).toBeGreaterThan(0);
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

describe("contextual resolution and version-bound audit paths", () => {
  it("allows shared equivalent lock contexts only in explicit semantic coverage mode", () => {
    const expected = {
      nodes: new Map([
        ["a", { key: "pkg@1.0.0" }],
        ["b", { key: "pkg@1.0.0" }],
      ]),
      edges: new Map(),
      roots: [
        { alias: "first", kind: "dependencies", target: "a" },
        { alias: "second", kind: "dependencies", target: "b" },
      ],
    };
    const actual = {
      nodes: new Map([["shared", { key: "pkg@1.0.0" }]]),
      edges: new Map(),
      roots: expected.roots.map((root) => ({ ...root, target: "shared" })),
    };
    expect(
      compareResolutionContexts(expected, actual).problems.length,
    ).toBeGreaterThan(0);
    const coverage = compareResolutionContexts(expected, actual, {
      allowEquivalentSharing: true,
    });
    expect(coverage.problems).toEqual([]);
    expect(coverage.differences.contextMultiplicityMismatches).toHaveLength(1);
  });
  const paired = () =>
    bunLock(
      {
        hostA: ["parent@1.0.0", { peerDependencies: { peer: "*" } }],
        hostB: ["parent@1.0.0", { peerDependencies: { peer: "*" } }],
        "hostA/peer": ["peer@1.0.0"],
        "hostB/peer": ["peer@2.0.0"],
      },
      {
        dependencies: { hostA: "npm:parent@1.0.0", hostB: "npm:parent@1.0.0" },
      },
    );

  it("rejects peer-binding swaps even when package and edge unions match", () => {
    const before = paired();
    const after = structuredClone(before);
    const peerA = after.packages["hostA/peer"];
    const peerB = after.packages["hostB/peer"];
    if (!peerA || !peerB) throw new Error("paired fixture lacks peer tuples");
    after.packages["hostA/peer"] = peerB;
    after.packages["hostB/peer"] = peerA;
    const result = compareGraphs(graph(before), graph(after));
    expect(result.differences.packagesOnlyInCandidate).toEqual([]);
    expect(result.differences.edgesOnlyInCandidate).toEqual([]);
    // compareGraphs merges the contextual comparison into `differences`.
    const differences: Record<string, unknown> = result.differences;
    const contextualRoots = differences.contextualRootsOnlyInCandidate;
    if (!Array.isArray(contextualRoots))
      throw new Error("compareGraphs omitted contextual root differences");
    expect(contextualRoots.length).toBe(2);
    expect(result.problems.length).toBeGreaterThan(0);
    expect(
      compareResolutionContexts(graph(before), graph(after), {
        allowEquivalentSharing: true,
      }).problems.length,
    ).toBeGreaterThan(0);
  });

  it("ignores opaque manager IDs while preserving contextual edges", () => {
    const before = graph(paired());
    const edgeLists: Map<string, Binding[]> = before.edges;
    const rootBindings: Binding[] = before.roots;
    const renames = new Map(
      [...before.nodes.keys()].map((id) => [id, `store(${id})`]),
    );
    const after = {
      ...before,
      nodes: new Map(
        [...before.nodes].map(([id, node]) => [
          renames.get(id),
          { ...node, id: renames.get(id) },
        ]),
      ),
      edges: new Map(
        [...edgeLists].map(([id, edges]) => [
          renames.get(id),
          edges.map((edge) => ({ ...edge, target: renames.get(edge.target) })),
        ]),
      ),
      roots: rootBindings.map((root) => ({
        ...root,
        target: renames.get(root.target),
      })),
    };
    expect(compareGraphs(before, after).problems).toEqual([]);
  });

  it("rejects renamed dependency aliases and changed dependency kinds", () => {
    const before = graph(
      bunLock(
        { a: ["a@1.0.0", { dependencies: { b: "1.0.0" } }], b: ["b@1.0.0"] },
        { dependencies: { a: "1.0.0" } },
      ),
    );
    for (const change of [
      { alias: "other" },
      { kind: "optionalDependencies" },
    ]) {
      const after = structuredClone(before);
      Object.assign(after.edges.get("a")![0], change);
      expect(compareGraphs(before, after).problems.length).toBeGreaterThan(0);
    }
  });

  it("converges on cyclic resolutions without erasing root/context differences", () => {
    const before = graph(
      bunLock(
        {
          a: ["a@1.0.0", { dependencies: { b: "1.0.0" } }],
          b: ["b@1.0.0", { dependencies: { a: "1.0.0" } }],
        },
        { dependencies: { a: "1.0.0" } },
      ),
    );
    expect(compareGraphs(before, structuredClone(before)).problems).toEqual([]);
    const after = structuredClone(before);
    after.edges.get("b")![0].alias = "renamed";
    expect(compareGraphs(before, after).problems.length).toBeGreaterThan(0);
  });

  it("keeps vulnerable development version separate from safe production version", () => {
    const g = graph(
      bunLock(
        {
          dev: ["parent@1.0.0", { dependencies: { victim: "1.0.0" } }],
          prod: ["parent@2.0.0", { dependencies: { victim: "2.0.0" } }],
          "dev/victim": ["victim@1.0.0"],
          "prod/victim": ["victim@2.0.0"],
        },
        {
          dependencies: { prod: "npm:parent@2.0.0" },
          devDependencies: { dev: "npm:parent@1.0.0" },
        },
      ),
    );
    // Deliberately identical printed path; version and production must remain bound.
    const roots: Binding[] = g.roots;
    roots.forEach((root) => {
      root.alias = "parent";
    });
    expect(paths(g, "victim")).toEqual([
      { path: ".>parent>victim", production: false, versions: ["1.0.0"] },
      { path: ".>parent>victim", production: true, versions: ["2.0.0"] },
    ]);
  });

  it("rejects libc loss, including libc differences confined to one context", () => {
    const before = graph(paired());
    before.nodes.get("hostA")!.libc = ["glibc"];
    const after = structuredClone(before);
    after.nodes.get("hostA")!.libc = [];
    expect(compareGraphs(before, after).problems.length).toBeGreaterThan(0);
  });
});

describe("declared override selection and strict lock schemas", () => {
  const tree = (version: string, declared: string) =>
    graph(
      bunLock(
        {
          parent: ["parent@4.0.0", { dependencies: { child: declared } }],
          child: [`child@${version}`],
        },
        { dependencies: { parent: "4.0.0" } },
      ),
    );

  it("allows a correctly pinned target inside the declared selector", () => {
    expect(
      overrideProblems(tree("1.9.9", "^1.0.0"), { "child@^1.0.0": "1.9.9" })
        .problems,
    ).toEqual([]);
  });

  it("does not use an inapplicable parent override to explain a mismatched request", () => {
    const g = tree("3.2.1", "^1.0.0");
    const rules = { "parent@^1.0.0>child@^1.0.0": "3.2.1" };
    expect(overrideProblems(g, rules).inactive).toEqual(Object.keys(rules));
    expect(declaredRangeProblems(g, rules).problems).toEqual([
      "parent@4.0.0 -> child@3.2.1: outside declared ^1.0.0",
    ]);
  });

  it("uses declared overlap when the resolved target lies outside the selector", () => {
    const g = tree("9.0.0", "^1.0.0");
    expect(overrideProblems(g, { "child@<2.0.0": "2.0.0" }).problems).toEqual([
      "child@<2.0.0: parent@4.0.0>child@9.0.0 resolved 9.0.0, override requires 2.0.0",
    ]);
  });

  it("selects parent-range before parent before top-level regardless of object order", () => {
    const entries: [string, string][] = [
      ["child", "1.0.0"],
      ["parent>child", "2.0.0"],
      ["parent@^4>child", "3.0.0"],
    ];
    for (const order of [entries, [...entries].reverse()]) {
      const result = overrideProblems(
        tree("3.0.0", "^1.0.0"),
        Object.fromEntries(order),
      );
      expect(result.problems).toEqual([]);
      expect(result.applied["parent@^4>child"]).toBe(1);
      expect(
        declaredRangeProblems(
          tree("3.0.0", "^1.0.0"),
          Object.fromEntries(order),
        ).problems,
      ).toEqual([]);
    }
  });

  it("uses child-range specificity and pinned Bun lexical tie-breaks", () => {
    const result = overrideProblems(tree("2.0.0", "^1.0.0"), {
      "parent>child": "3.0.0",
      "parent>child@^1": "2.0.0",
      "parent>child@~1": "4.0.0",
    });
    expect(result.problems).toEqual([]);
    expect(result.applied["parent>child@^1"]).toBe(1);
  });

  it("fails missing child request provenance and never substitutes a resolution", () => {
    const g = tree("1.9.9", "^1.0.0");
    const edge = g.edges.get("parent")![0];
    edge.declared = null;
    edge.declaredSource = "unavailable";
    expect(overrideProblems(g, { "child@^1": "1.9.9" }).problems).toEqual([
      "child@^1: parent@4.0.0>child@1.9.9: original declared range unavailable; selector applicability unproven",
    ]);
  });

  it("does not let missing lower-priority provenance invalidate a known parent winner", () => {
    const g = tree("1.9.9", "^1.0.0");
    g.edges.get("parent")![0].declaredSource = "unavailable";
    expect(
      overrideProblems(g, { "child@^1": "3.0.0", "parent>child": "1.9.9" })
        .problems,
    ).toEqual([]);
  });

  it("rejects malformed metadata/dependency maps and duplicate decoded JSON keys", () => {
    const good = bunLock({ a: ["a@1.0.0"] }, { dependencies: { a: "1.0.0" } });
    const malformed = structuredClone(good);
    // Deliberately malformed: an array where the metadata object belongs.
    tuple(malformed, "a")[2] = [];
    expect(graphProblems(graph(malformed)).length).toBeGreaterThan(0);
    for (const metadata of [
      { dependencies: [] },
      { optionalPeers: {} },
      { cpu: [false] },
      { libc: {} },
    ]) {
      const bad = structuredClone(good);
      tuple(bad, "a")[2] = metadata;
      expect(() => graph(bad)).toThrow();
    }
    expect(() => graph({ ...good, workspaces: [] })).toThrow();
    expect(() => graph({ ...good, workspaces: {} })).toThrow();
    expect(() => graph({ ...good, packages: [] })).toThrow();
    expect(() =>
      parseBunLockText('{"packages": {}, "packa\\u0067es": {}}'),
    ).toThrow(/duplicate/i);
  });

  it("preserves Bun's real scalar native metadata", () => {
    const g = graph(
      bunLock(
        { a: ["a@1.0.0", { os: "darwin", cpu: "arm64" }] },
        { dependencies: { a: "1.0.0" } },
      ),
    );
    expect(graphProblems(g)).toEqual([]);
    expect(g.nodes.get("a")!.os).toEqual(["darwin"]);
  });
});

describe("safe numeric SemVer and declared range overlap", () => {
  it("rejects unsafe exact and partial components and unsafe generated bounds", () => {
    for (const version of [
      "9007199254740992.0.0",
      "1.9007199254740992.0",
      "1.0.9007199254740992",
    ]) {
      expect(() => parseVersion(version)).toThrow(/Unsafe/);
      expect(isExactVersion(version)).toBe(false);
    }
    for (const range of [
      "9007199254740992",
      "1.9007199254740992.x",
      "1.x.9007199254740992",
      "^9007199254740991.0.0",
      "1.2.3-01",
      "1.x.2",
    ])
      expect(() => satisfies("1.0.0", range)).toThrow();
  });

  it("orders arbitrarily long numeric prerelease identifiers without rounding", () => {
    expect(
      compareVersions("1.0.0-9007199254740992", "1.0.0-9007199254740993"),
    ).toBeLessThan(0);
    expect(
      compareVersions(
        "1.0.0-9999999999999999999999",
        "1.0.0-10000000000000000000000",
      ),
    ).toBeLessThan(0);
  });

  it.each([
    ["^7.3.0", "<7.5.2", true],
    ["^7.5.2", "<7.5.2", false],
    ["^1.0.0", "1.9.9", true],
    ["^1.0.0", ">=2", false],
    ["<1 || >=3", "2.x", false],
    [">=1 <=2", "2.0.0", true],
    [">=1 <2", "2.0.0", false],
    [">2 <1", "*", false],
  ] as const)("overlap %s with %s is %s", (left, right, expected) => {
    expect(rangesOverlap(left, right)).toBe(expected);
    expect(rangesOverlap(right, left)).toBe(expected);
  });
});
