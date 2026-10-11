import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  installedGraph,
  compareInstalled,
} from "../../scripts/ci/installed-graph.mjs";

type Package = {
  id: string;
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peers?: Record<string, string>;
  links?: Record<string, string>;
  os?: string[];
  scripts?: unknown;
};
const base = mkdtempSync(join(tmpdir(), "t03-installed-corrections-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const integrity = `sha512-${createHash("sha512").update("fixture").digest("base64")}`;
function fixture(specs: Package[], rootIds = specs.map((spec) => spec.id)) {
  const dir = mkdtempSync(join(base, "p-"));
  const own = (id: string) => {
    const spec = specs.find((row) => row.id === id);
    if (!spec) throw new Error(`Unknown fixture ${id}`);
    return join(dir, "node_modules/.bun", id, "node_modules", spec.name);
  };
  for (const spec of specs) {
    mkdirSync(own(spec.id), { recursive: true });
    writeFileSync(
      join(own(spec.id), "package.json"),
      JSON.stringify({
        name: spec.name,
        version: spec.version,
        dependencies: spec.dependencies,
        peerDependencies: spec.peers,
        scripts: spec.scripts,
      }),
    );
  }
  for (const spec of specs)
    for (const [alias, id] of Object.entries(spec.links ?? {})) {
      const link = join(
        dir,
        "node_modules/.bun",
        spec.id,
        "node_modules",
        alias,
      );
      mkdirSync(join(link, ".."), { recursive: true });
      symlinkSync(own(id), link);
    }
  const roots = rootIds.map((id, index) => ({
    alias: `root-${index}`,
    kind: "dependencies",
    target: id,
  }));
  for (const root of roots)
    symlinkSync(own(root.target), join(dir, "node_modules", root.alias));
  const expectedGraph = {
    nodes: new Map(
      specs.map((spec) => [
        spec.id,
        {
          id: spec.id,
          key: `${spec.name}@${spec.version}`,
          name: spec.name,
          version: spec.version,
          integrity,
          os: spec.os ?? [],
          cpu: [],
          libc: [],
        },
      ]),
    ),
    edges: new Map(
      specs.map((spec) => [
        spec.id,
        Object.entries(spec.links ?? {}).map(([alias, target]) => ({
          alias,
          kind: spec.peers?.[alias] ? "peerDependencies" : "dependencies",
          target,
        })),
      ]),
    ),
    roots,
    problems: [],
  };
  return {
    dir,
    own,
    expectedGraph,
    options: { expectedGraph, platform: { os: "darwin", cpu: "arm64" } },
  };
}
const leaf = (version: string): Package => ({
  id: `leaf@${version}`,
  name: "leaf",
  version,
});
const host = (id: string, target: string): Package => ({
  id,
  name: "host",
  version: "1.0.0",
  dependencies: { leaf: "*" },
  links: { leaf: target },
});

describe("complete installed resolution evidence", () => {
  it("permits physical sharing only when frozen semantic contexts are identical", () => {
    const f = fixture(
      [host("host@1.0.0", "leaf@1.0.0"), leaf("1.0.0")],
      ["host@1.0.0"],
    );
    const original = f.expectedGraph.nodes.get("leaf@1.0.0");
    if (!original) throw new Error("Missing leaf fixture");
    f.expectedGraph.nodes.set("duplicate-leaf", {
      ...original,
      id: "duplicate-leaf",
    });
    f.expectedGraph.edges.set("duplicate-leaf", []);
    f.expectedGraph.roots.push({
      alias: "also-leaf",
      kind: "dependencies",
      target: "duplicate-leaf",
    });
    symlinkSync(f.own("leaf@1.0.0"), join(f.dir, "node_modules/also-leaf"));
    expect(installedGraph(f.dir, "bun", f.options).resolution.nodes.size).toBe(
      2,
    );
  });
  it("refuses sharing when frozen same-version contexts have different bindings", () => {
    const f = fixture([
      host("host@1.0.0+one", "leaf@1.0.0"),
      host("host@1.0.0+two", "leaf@2.0.0"),
      leaf("1.0.0"),
      leaf("2.0.0"),
    ]);
    rmSync(join(f.dir, "node_modules/.bun/host@1.0.0+two"), {
      recursive: true,
    });
    unlinkSync(join(f.dir, "node_modules/root-1"));
    symlinkSync(f.own("host@1.0.0+one"), join(f.dir, "node_modules/root-1"));
    expect(() => installedGraph(f.dir, "bun", f.options)).toThrow(
      /does not match expected graph/,
    );
  });
  it("requires an independently supplied graph or existing lock", () => {
    const f = fixture([leaf("1.0.0")]);
    expect(() => installedGraph(f.dir, "bun")).toThrow(/expected graph/);
  });
  it("rejects removed package coverage even when another package remains", () => {
    const f = fixture(
      [host("host@1.0.0", "leaf@1.0.0"), leaf("1.0.0")],
      ["host@1.0.0"],
    );
    rmSync(join(f.dir, "node_modules/.bun/leaf@1.0.0"), { recursive: true });
    unlinkSync(join(f.dir, "node_modules/.bun/host@1.0.0/node_modules/leaf"));
    expect(() => installedGraph(f.dir, "bun", f.options)).toThrow(
      /expected inventory/,
    );
  });
  it("rejects missing required dependency links even with both manifests present", () => {
    const f = fixture(
      [host("host@1.0.0", "leaf@1.0.0"), leaf("1.0.0")],
      ["host@1.0.0"],
    );
    unlinkSync(join(f.dir, "node_modules/.bun/host@1.0.0/node_modules/leaf"));
    expect(() => installedGraph(f.dir, "bun", f.options)).toThrow(
      /no accounted resolution/,
    );
  });
  it("includes legitimate shared resolution when the direct link is absent", () => {
    const f = fixture(
      [host("host@1.0.0", "leaf@1.0.0"), leaf("1.0.0")],
      ["host@1.0.0"],
    );
    unlinkSync(join(f.dir, "node_modules/.bun/host@1.0.0/node_modules/leaf"));
    mkdirSync(join(f.dir, "node_modules/.bun/node_modules"));
    symlinkSync(
      f.own("leaf@1.0.0"),
      join(f.dir, "node_modules/.bun/node_modules/leaf"),
    );
    expect(
      installedGraph(f.dir, "bun", f.options).resolution.edges.get(
        "host@1.0.0",
      ),
    ).toEqual([{ alias: "leaf", kind: "dependencies", target: "leaf@1.0.0" }]);
  });
  it("rejects a deleted declaration and link despite unchanged package/root coverage", () => {
    const f = fixture([host("host@1.0.0", "leaf@1.0.0"), leaf("1.0.0")]);
    unlinkSync(join(f.dir, "node_modules/.bun/host@1.0.0/node_modules/leaf"));
    writeFileSync(
      join(f.own("host@1.0.0"), "package.json"),
      JSON.stringify({ name: "host", version: "1.0.0" }),
    );
    expect(() => installedGraph(f.dir, "bun", f.options)).toThrow(
      /does not match expected graph/,
    );
  });
  it("does not accept swapped peer contexts merely because edge unions match", () => {
    const specs = [
      host("host@1.0.0+one", "leaf@1.0.0"),
      host("host@1.0.0+two", "leaf@2.0.0"),
      leaf("1.0.0"),
      leaf("2.0.0"),
    ];
    const a = fixture(specs, ["host@1.0.0+one", "host@1.0.0+two"]);
    const b = fixture(
      [
        host("host@1.0.0+one", "leaf@2.0.0"),
        host("host@1.0.0+two", "leaf@1.0.0"),
        leaf("1.0.0"),
        leaf("2.0.0"),
      ],
      ["host@1.0.0+one", "host@1.0.0+two"],
    );
    const result = compareInstalled(
      installedGraph(a.dir, "bun", a.options),
      installedGraph(b.dir, "bun", b.options),
    );
    expect(result.edgesOnlyInCandidate).toEqual([]);
    expect(result.contexts.problems.length).toBeGreaterThan(0);
  });
  it("retains aliases, edge kinds and multiplicity, while allowing opaque ID renaming", () => {
    const a = fixture(
      [host("host@1.0.0+one", "leaf@1.0.0"), leaf("1.0.0")],
      ["host@1.0.0+one"],
    );
    const b = fixture(
      [host("host@1.0.0+renamed", "leaf@1.0.0"), leaf("1.0.0")],
      ["host@1.0.0+renamed"],
    );
    expect(
      compareInstalled(
        installedGraph(a.dir, "bun", a.options),
        installedGraph(b.dir, "bun", b.options),
      ).contexts.problems,
    ).toEqual([]);
    const c = fixture(
      [
        {
          id: "host@1.0.0+peer",
          name: "host",
          version: "1.0.0",
          peers: { leaf: "*" },
          links: { leaf: "leaf@1.0.0" },
        },
        leaf("1.0.0"),
      ],
      ["host@1.0.0+peer"],
    );
    expect(
      compareInstalled(
        installedGraph(a.dir, "bun", a.options),
        installedGraph(c.dir, "bun", c.options),
      ).contexts.problems.length,
    ).toBeGreaterThan(0);
    const d = fixture(
      [
        host("host@1.0.0+one", "leaf@1.0.0"),
        host("host@1.0.0+two", "leaf@1.0.0"),
        leaf("1.0.0"),
      ],
      ["host@1.0.0+one", "host@1.0.0+two"],
    );
    expect(
      compareInstalled(
        installedGraph(a.dir, "bun", a.options),
        installedGraph(d.dir, "bun", d.options),
      ).contexts.problems.length,
    ).toBeGreaterThan(0);
  });
  it("rejects unknown entries, incorrect ownership, and malformed manifest schemas", () => {
    const f = fixture([leaf("1.0.0")]);
    mkdirSync(join(f.dir, "node_modules/.bun/missing@1.0.0"));
    expect(() => installedGraph(f.dir, "bun", f.options)).toThrow(
      /missing node_modules/,
    );
    const wrong = fixture([leaf("1.0.0")]);
    writeFileSync(
      join(wrong.own("leaf@1.0.0"), "package.json"),
      '{"name":"different","version":"1.0.0"}',
    );
    expect(() => installedGraph(wrong.dir, "bun", wrong.options)).toThrow(
      /ownership/,
    );
    const bad = fixture([{ ...leaf("1.0.0"), scripts: { install: true } }]);
    expect(() => installedGraph(bad.dir, "bun", bad.options)).toThrow(
      /scripts schema/,
    );
    const duplicate = fixture([leaf("1.0.0")]);
    writeFileSync(
      join(duplicate.own("leaf@1.0.0"), "package.json"),
      '{"name":"leaf","name":"hidden","version":"1.0.0"}',
    );
    expect(() =>
      installedGraph(duplicate.dir, "bun", duplicate.options),
    ).toThrow(/Duplicate|duplicate/);
  });
  it("rejects external and unaccounted links before reading external manifests", () => {
    const external = fixture([leaf("1.0.0")]);
    const f = fixture([leaf("1.0.0")]);
    symlinkSync(
      external.own("leaf@1.0.0"),
      join(f.dir, "node_modules/.bun/leaf@1.0.0/node_modules/escaped"),
    );
    expect(() => installedGraph(f.dir, "bun", f.options)).toThrow(
      /outside|escape/,
    );
    const unaccounted = fixture([leaf("1.0.0")]);
    const path = join(unaccounted.own("leaf@1.0.0"), "unaccounted");
    mkdirSync(path);
    symlinkSync(
      path,
      join(unaccounted.dir, "node_modules/.bun/leaf@1.0.0/node_modules/hidden"),
    );
    expect(() =>
      installedGraph(unaccounted.dir, "bun", unaccounted.options),
    ).toThrow(/unaccounted/);
  });
});
