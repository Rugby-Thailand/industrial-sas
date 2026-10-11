// T03: opt-in Bun audit adapter. pnpm's audit gates stay authoritative; these
// cases prove the candidate fails closed and reuses the unchanged policies.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { auditProblems } from "../../scripts/ci/audit-dependencies.mjs";
import {
  coverageProblems,
  decide,
  normalizeBunAudit,
  rawAuditProblems,
  runBunAudit,
  AUDIT_OUTPUT_LIMIT,
} from "../../scripts/ci/bun-audit.mjs";
import {
  bunGraph,
  bunKeySegments,
  loadPnpmScope,
  pnpmAuditTreePaths,
} from "../../scripts/ci/lockfile-graph.mjs";
import { auditSummary } from "../../scripts/ci/report-lib.mjs";
import { parseUniqueJson } from "../../scripts/ci/json-input.mjs";

type Scope = "app" | "release";
type Pkg = {
  version: string;
  dependencies?: Record<string, string>;
  registry?: string;
};

const read = (path: string) => readFileSync(path, "utf8");
const fixture = (name: string) => read(`tests/fixtures/bun-audit/${name}`);
const exceptions = JSON.parse(
  read("scripts/ci/dependency-exceptions.json"),
).exceptions;
const exception = exceptions[0];
// Deterministic clock for fixtures; real audits use Date.now().
const now = Date.parse("2026-10-10T00:00:00Z");
const realBraces = JSON.parse(fixture("bun-app-full.stdout")).braces[0];

const integrity = (seed: string) =>
  `sha512-${createHash("sha512").update(seed).digest("base64")}`;

/** A bun.lock v3 object (valid JSON is valid bun.lock text). */
function bunLock(
  packages: Record<string, Pkg>,
  workspace: Record<string, Record<string, string>>,
) {
  return {
    lockfileVersion: 3,
    workspaces: { "": { name: "fixture", ...workspace } },
    packages: Object.fromEntries(
      Object.entries(packages).map(([key, pkg]) => [
        key,
        [
          `${bunKeySegments(key).at(-1)}@${pkg.version}`,
          pkg.registry ?? "",
          pkg.dependencies ? { dependencies: pkg.dependencies } : {},
          integrity(key),
        ],
      ]),
    ),
  };
}

/**
 * Scope-shaped graph: the exactly allowed braces chain, optionally an
 * unallowed second chain, and optionally without the allowed chain.
 */
function scopeLock(
  scope: Scope,
  {
    allowed = true,
    extra = false,
    braces = "3.0.3",
  }: { allowed?: boolean; extra?: boolean; braces?: string } = {},
) {
  const tail: Record<string, Pkg> = {
    "fast-glob": { version: "3.3.3", dependencies: { micromatch: "4.0.8" } },
    micromatch: { version: "4.0.8", dependencies: { braces } },
    braces: { version: braces },
  };
  if (scope === "app") {
    const packages: Record<string, Pkg> = {
      ...tail,
      next: { version: "16.3.8" },
    };
    const dev: Record<string, string> = {};
    if (allowed) {
      dev["eslint-config-next"] = "16.3.8";
      packages["eslint-config-next"] = {
        version: "16.3.8",
        dependencies: { "@next/eslint-plugin-next": "16.3.8" },
      };
      packages["@next/eslint-plugin-next"] = {
        version: "16.3.8",
        dependencies: { "fast-glob": "3.3.3" },
      };
    }
    if (extra) {
      dev.shadcn = "4.17.0";
      packages.shadcn = {
        version: "4.17.0",
        dependencies: { "fast-glob": "3.3.3" },
      };
    }
    return bunLock(packages, {
      dependencies: { next: "16.3.8" },
      devDependencies: dev,
    });
  }
  const vercelDeps: Record<string, string> = {};
  const packages: Record<string, Pkg> = { ...tail };
  if (allowed) {
    vercelDeps["@vercel/backends"] = "1.0.0";
    packages["@vercel/backends"] = {
      version: "1.0.0",
      dependencies: { "ts-morph": "12.0.0" },
    };
    packages["ts-morph"] = {
      version: "12.0.0",
      dependencies: { "@ts-morph/common": "0.11.1" },
    };
    packages["@ts-morph/common"] = {
      version: "0.11.1",
      dependencies: { "fast-glob": "3.3.3" },
    };
  }
  if (extra) {
    vercelDeps["@vercel/static-config"] = "3.4.4";
    packages["@vercel/static-config"] = {
      version: "3.4.4",
      dependencies: { "fast-glob": "3.3.3" },
    };
  }
  packages.vercel = { version: "63.1.0", dependencies: vercelDeps };
  return bunLock(packages, { dependencies: { vercel: "63.1.0" } });
}

const graphOf = (scope: Scope, options = {}) =>
  bunGraph(scopeLock(scope, options), { scope });

type Child = {
  status: number | null;
  signal: string | null;
  timedOut: boolean;
  spawnError: string | null;
  stdout: string;
  stderr: string;
  outputExceeded?: boolean;
};
const child = (raw: unknown, overrides: Partial<Child> = {}): Child => ({
  status: raw && typeof raw === "object" && Object.keys(raw).length ? 1 : 0,
  signal: null,
  timedOut: false,
  spawnError: null,
  stdout: typeof raw === "string" ? raw : JSON.stringify(raw),
  stderr: "",
  ...overrides,
});
const advisory = (changes: Record<string, unknown> = {}) => ({
  ...realBraces,
  ...changes,
});

function run(
  mode: "exceptions" | "runtime" | "summary",
  scope: Scope,
  {
    raw = { braces: [advisory()] } as unknown,
    graph = graphOf(scope),
    childOverrides = {} as Partial<Child>,
    policy = exceptions,
    at = now,
    coverage = [] as string[],
  } = {},
) {
  return decide(mode, {
    child: child(raw, childOverrides),
    graph,
    coverage,
    exceptions: policy,
    scope,
    now: at,
  });
}

const otherScope = (scope: Scope): Scope =>
  scope === "app" ? "release" : "app";

describe.each(["app", "release"] as const)(
  "Bun audit adapter (%s scope)",
  (scope) => {
    const allowedPaths: string[] = exception.paths[scope];

    it("accepts a clean report in every mode", () => {
      for (const mode of ["exceptions", "runtime", "summary"] as const)
        expect(run(mode, scope, { raw: {} }).problems).toEqual([]);
      expect(run("summary", scope, { raw: {} }).summary?.counts).toEqual({
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
        info: 0,
      });
    });

    it.each(["exceptions", "runtime", "summary"] as const)(
      "%s rejects invalid graph evidence even with a clean registry report",
      (mode) => {
        const invalidIntegrity = graphOf(scope);
        for (const node of invalidIntegrity.nodes.values())
          node.integrity = "invalid";
        expect(
          run(mode, scope, { raw: {}, graph: invalidIntegrity }).problems
            .length,
        ).toBeGreaterThan(0);
        const unresolved = graphOf(scope);
        unresolved.problems.push("unresolved dependency binding");
        expect(
          run(mode, scope, { raw: {}, graph: unresolved }).problems.length,
        ).toBeGreaterThan(0);
      },
    );

    it("accepts the exact allowed advisory, version, severity and every path before expiry", () => {
      const result = run("exceptions", scope);
      expect(result.problems).toEqual([]);
      const findings = Object.values(result.report?.advisories ?? {}).map(
        (row) => (row as { findings: unknown }).findings,
      );
      expect(findings).toEqual([[{ version: "3.0.3", paths: allowedPaths }]]);
      expect(Object.values(result.report?.advisories ?? {})[0]).toMatchObject({
        github_advisory_id: "GHSA-vfj7-8cjw-p6xm",
        module_name: "braces",
        severity: "high",
      });
    });

    it("rejects an unknown high advisory and a critical one", () => {
      const unknown = advisory({
        id: 9_000_001,
        url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
      });
      expect(
        run("exceptions", scope, { raw: { braces: [unknown] } }).problems,
      ).not.toEqual([]);
      expect(
        run("exceptions", scope, {
          raw: { braces: [advisory({ severity: "critical" })] },
        }).problems,
      ).not.toEqual([]);
      expect(
        run("exceptions", scope, {
          raw: { "fast-glob": [advisory({ vulnerable_versions: "<=3.3.3" })] },
        }).problems,
      ).not.toEqual([]);
    });

    it("rejects expired exceptions and the exact expiry boundary", () => {
      const expiry = Date.parse(exception.expiresAt);
      expect(run("exceptions", scope, { at: expiry - 1 }).problems).toEqual([]);
      expect(run("exceptions", scope, { at: expiry }).problems).not.toEqual([]);
      expect(
        run("exceptions", scope, { at: expiry + 86_400_000 }).problems,
      ).not.toEqual([]);
    });

    it("rejects a wrong package, version, severity, path or scope", () => {
      expect(
        run("exceptions", scope, {
          policy: [{ ...exception, package: "micromatch" }],
        }).problems,
      ).not.toEqual([]);
      expect(
        run("exceptions", scope, { graph: graphOf(scope, { braces: "3.0.2" }) })
          .problems,
      ).not.toEqual([]);
      expect(
        run("exceptions", scope, {
          policy: [{ ...exception, severity: "critical" }],
        }).problems,
      ).not.toEqual([]);
      expect(
        run("exceptions", scope, {
          graph: graphOf(scope, { allowed: false, extra: true }),
        }).problems,
      ).not.toEqual([]);
      expect(
        run("exceptions", otherScope(scope), { graph: graphOf(scope) })
          .problems,
      ).not.toEqual([]);
    });

    it("rejects mixed allowed and unallowed chains without dropping either path", () => {
      const result = run("exceptions", scope, {
        graph: graphOf(scope, { extra: true }),
      });
      expect(result.problems).toEqual([
        "A high or critical advisory has no valid exact-chain exception.",
      ]);
      const paths = Object.values(result.report?.advisories ?? {}).flatMap(
        (row) =>
          (row as { findings: { paths: string[] }[] }).findings.flatMap(
            (f) => f.paths,
          ),
      );
      expect(paths).toHaveLength(2);
      expect(paths).toEqual(expect.arrayContaining(allowedPaths));
    });

    it("rejects malformed, empty, missing and unknown advisory data", () => {
      const malformed: unknown[] = [
        [],
        null,
        "[]",
        { braces: [] },
        { braces: {} },
        { braces: [null] },
        { braces: [advisory({ url: "https://example.test/x" })] },
        { braces: [advisory({ id: "1" })] },
        { braces: [advisory({ vulnerable_versions: "" })] },
        { braces: [advisory({ severity: "severe" })] },
        { braces: [advisory({ severity: undefined })] },
      ];
      for (const raw of malformed)
        expect(
          run("exceptions", scope, { raw, childOverrides: { status: 1 } })
            .problems,
        ).not.toEqual([]);
      // Unknown package, unparsable range, version outside every installed one.
      for (const raw of [
        { "left-pad": [advisory()] },
        { braces: [advisory({ vulnerable_versions: "not a range" })] },
        { braces: [advisory({ vulnerable_versions: "<3.0.0" })] },
      ])
        for (const mode of ["exceptions", "runtime", "summary"] as const)
          expect(run(mode, scope, { raw }).problems).not.toEqual([]);
    });

    it("rejects registry errors, request failures and exit/report contradictions", () => {
      const cases: [unknown, Partial<Child>][] = [
        ["", { status: 0 }],
        ["", { status: 1, stderr: "error: audit request failed\n" }],
        [{}, { status: 1 }],
        [{}, { status: 0, stderr: "audit request failed" }],
        [{ error: "Service Unavailable" }, { status: 1 }],
        [{ message: "rate limited" }, { status: 1 }],
        [{ braces: [advisory()] }, { status: 0 }],
        ["<html>502 Bad Gateway</html>", { status: 1 }],
      ];
      for (const [raw, overrides] of cases)
        for (const mode of ["exceptions", "runtime", "summary"] as const)
          expect(
            run(mode, scope, { raw, childOverrides: overrides }).problems,
          ).not.toEqual([]);
    });

    it("rejects timeouts, signals, spawn failures and unexpected exit codes", () => {
      for (const [overrides, message] of [
        [
          { timedOut: true, status: null, signal: "SIGKILL" },
          "bun audit timed out",
        ],
        // Deadline fired but the child exited 0 before the kill landed.
        [{ timedOut: true, status: 0, signal: null }, "bun audit timed out"],
        [
          { outputExceeded: true, status: 0 },
          "bun audit output exceeded the supported bound",
        ],
        [
          { status: null, signal: "SIGTERM" },
          "bun audit terminated by SIGTERM",
        ],
        [
          { spawnError: "spawn bun ENOENT", status: null },
          "bun audit could not start: spawn bun ENOENT",
        ],
        [{ status: 2 }, "bun audit exited 2"],
      ] as [Partial<Child>, string][])
        expect(
          run("exceptions", scope, { raw: {}, childOverrides: overrides })
            .problems,
        ).toEqual([message]);
    });

    it("fails closed for skipped or private-registry packages even on a clean report", () => {
      const lock = scopeLock(scope);
      lock.packages.braces[1] = "https://registry.example.test/";
      expect(coverageProblems(bunGraph(lock, { scope }))).toEqual([
        "braces@3.0.3: non-default registry https://registry.example.test/; not audited",
      ]);
      expect(
        coverageProblems(graphOf(scope), {
          npmrc: "@corp:registry=https://r.example.test/\n",
        }),
      ).not.toEqual([]);
      expect(
        coverageProblems(graphOf(scope), {
          bunfig: '[install.scopes]\ncorp = "https://r.example.test/"\n',
        }),
      ).not.toEqual([]);
      for (const bunfig of [
        '[install]\n"registry" = "https://r.example.test/"',
        'install = { scopes = { corp = "https://r.example.test/" } }',
      ])
        expect(coverageProblems(graphOf(scope), { bunfig })).not.toEqual([]);
      expect(
        coverageProblems(graphOf(scope), { npmrc: "save-exact=true\n" }),
      ).toEqual([]);
      expect(
        run("exceptions", scope, { raw: {}, coverage: ["x: not audited"] })
          .problems,
      ).toEqual(["x: not audited"]);
    });

    it("rejects an invalid exception record (owner, reason or scope paths missing)", () => {
      for (const broken of [
        { ...exception, owner: "" },
        { ...exception, reason: "" },
        {
          ...exception,
          paths: { [otherScope(scope)]: exception.paths[otherScope(scope)] },
        },
        { ...exception, expiresAt: "soon" },
      ])
        expect(
          run("exceptions", scope, { policy: [broken] }).problems,
        ).not.toEqual([]);
    });

    it("summarizes every severity with accurate counts", () => {
      const raw = {
        braces: [
          advisory(),
          advisory({
            id: 2,
            severity: "low",
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccd",
          }),
        ],
        micromatch: [
          advisory({
            id: 3,
            severity: "moderate",
            vulnerable_versions: "<5.0.0",
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-ccce",
          }),
        ],
      };
      const result = run("summary", scope, { raw });
      expect(result.problems).toEqual([]);
      expect(result.summary?.counts).toEqual({
        critical: 0,
        high: 1,
        moderate: 1,
        low: 1,
        info: 0,
      });
      expect(
        result.summary?.advisories.map((a: { ghsa: string }) => a.ghsa),
      ).toEqual([
        "GHSA-vfj7-8cjw-p6xm",
        "GHSA-aaaa-bbbb-ccce",
        "GHSA-aaaa-bbbb-cccd",
      ]);
    });
  },
);

describe("Bun audit runtime (production) scope", () => {
  it("ignores dev-only advisories in the app, as pnpm audit --prod does", () => {
    expect(run("runtime", "app").problems).toEqual([]);
    expect(run("runtime", "app").report?.metadata.vulnerabilities.high).toBe(0);
  });

  it("rejects a production high advisory even when an exception would cover it", () => {
    // Release dependencies are all production; runtime mode has no exceptions.
    expect(run("exceptions", "release").problems).toEqual([]);
    expect(run("runtime", "release").problems).toEqual([
      "A high or critical advisory has no valid exact-chain exception.",
    ]);
    const prodApp = bunLock(
      {
        next: { version: "16.3.8", dependencies: { braces: "3.0.3" } },
        braces: { version: "3.0.3" },
      },
      { dependencies: { next: "16.3.8" } },
    );
    expect(
      run("runtime", "app", { graph: bunGraph(prodApp, { scope: "app" }) })
        .problems,
    ).not.toEqual([]);
  });

  it("allows production moderate advisories (high threshold) but still counts them", () => {
    const raw = { braces: [advisory({ severity: "moderate" })] };
    expect(run("runtime", "release", { raw }).problems).toEqual([]);
    expect(run("summary", "release", { raw }).summary?.counts.moderate).toBe(1);
  });

  it("validates the raw report before any production filtering", () => {
    expect(
      rawAuditProblems(child({ braces: [advisory({ severity: "severe" })] })),
    ).not.toEqual([]);
    expect(() =>
      normalizeBunAudit(
        { braces: [advisory()] },
        graphOf("app", { braces: "4.0.0" }),
        { production: true },
      ),
    ).toThrow(/matches no installed version/);
  });
});

describe("matched real registry reports (frozen 2026-10-11 captures)", () => {
  // Raw `bun audit --json` and `pnpm audit --json` captured minutes apart
  // against the same frozen locks; byte-identical copies of the external
  // evidence (hashes in docs/reviews/bun-elysia/T03/source-manifest.json).
  const raw = (scope: Scope, mode: "full" | "prod") => ({
    stdout: fixture(`bun-${scope}-${mode}.stdout`),
    status: Number(fixture(`bun-${scope}-${mode}.exit`).trim()),
  });
  const realChild = (scope: Scope, mode: "full" | "prod"): Child => ({
    ...child({}),
    ...raw(scope, mode),
  });

  it.each(["app", "release"] as const)(
    "%s: pnpm's compressed path passes, every real braces chain fails, summaries agree",
    (scope) => {
      const { lock, graph } = loadPnpmScope(scope);
      const pnpmReport = JSON.parse(fixture(`pnpm-${scope}-full.stdout`));
      // Old decision: pnpm reports one path per snapshot and passes.
      expect(auditProblems(pnpmReport, exceptions, scope, now)).toEqual([]);
      const pnpmBraces = Object.values(pnpmReport.advisories).find(
        (row) => (row as { module_name: string }).module_name === "braces",
      ) as { findings: { paths: string[] }[] };
      expect(pnpmBraces.findings[0].paths).toEqual(exception.paths[scope]);
      // That one path is exactly pnpm 10.33.2's audit-tree walk.
      expect(pnpmAuditTreePaths(lock).get("braces@3.0.3")).toEqual(
        exception.paths[scope],
      );
      // New decision: all simple chains, so the unallowed ones are rejected.
      const result = decide("exceptions", {
        child: realChild(scope, "full"),
        graph,
        coverage: [],
        exceptions,
        scope,
        now,
      });
      expect(result.problems).toEqual([
        "A high or critical advisory has no valid exact-chain exception.",
      ]);
      const braces = Object.values(result.report?.advisories ?? {}).find(
        (row) => (row as { module_name: string }).module_name === "braces",
      ) as { findings: { version: string; paths: string[] }[] };
      expect(braces.findings).toHaveLength(1);
      expect(braces.findings[0].version).toBe("3.0.3");
      expect(braces.findings[0].paths.length).toBeGreaterThan(1);
      expect(braces.findings[0].paths).toEqual(
        expect.arrayContaining(exception.paths[scope]),
      );
      // All-severity counts match pnpm's report for the same advisories.
      const summary = decide("summary", {
        child: realChild(scope, "full"),
        graph,
        coverage: [],
        exceptions,
        scope,
        now,
      });
      expect(summary.problems).toEqual([]);
      expect(summary.summary?.counts).toEqual(auditSummary(pnpmReport).counts);
    },
  );

  it("runtime: the app production report is clean; the release one is not", () => {
    const app = loadPnpmScope("app").graph;
    const release = loadPnpmScope("release").graph;
    expect(raw("app", "prod")).toEqual({ stdout: "{}\n", status: 0 });
    expect(
      decide("runtime", {
        child: realChild("app", "prod"),
        graph: app,
        coverage: [],
        exceptions,
        scope: "app",
        now,
      }).problems,
    ).toEqual([]);
    expect(
      decide("runtime", {
        child: realChild("release", "prod"),
        graph: release,
        coverage: [],
        exceptions,
        scope: "release",
        now,
      }).problems,
    ).not.toEqual([]);
  });
});

describe("bun-audit.mjs CLI (replay only; no network)", () => {
  const dir = mkdtempSync(join(tmpdir(), "t03-bun-audit-cli-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (args: string[]) =>
    spawnSync(process.execPath, ["scripts/ci/bun-audit.mjs", ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });

  it("passes a clean replay, fails a mixed one and rejects bad usage", () => {
    writeFileSync(
      join(dir, "bun.lock"),
      JSON.stringify(scopeLock("app", { extra: true })),
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(scopeLock("app", { extra: true }).workspaces[""]),
    );
    writeFileSync(join(dir, "clean.json"), "{}");
    writeFileSync(
      join(dir, "mixed.json"),
      JSON.stringify({ braces: [advisory()] }),
    );
    const base = ["--scope=app", `--bun-dir=${dir}`];
    expect(
      cli([...base, "--mode=runtime", `--replay=${join(dir, "clean.json")}:0`])
        .status,
    ).toBe(0);
    const mixed = cli([
      ...base,
      "--mode=exceptions",
      `--replay=${join(dir, "mixed.json")}:1`,
    ]);
    expect(mixed.status).toBe(1);
    expect(mixed.stdout).toContain("braces@3.0.3: 2 path(s)");
    expect(
      cli([...base, "--mode=summary", `--replay=${join(dir, "clean.json")}:1`])
        .status,
    ).toBe(1);
    expect(
      cli(["--scope=other", `--bun-dir=${dir}`, "--mode=runtime"]).status,
    ).toBe(2);
    expect(
      cli([...base, "--mode=runtime", "--ignore=GHSA-vfj7-8cjw-p6xm"]).status,
    ).toBe(2);
  });
});

describe("unambiguous JSON security evidence", () => {
  it.each([
    '{"packages":{},"packages":{}}',
    '{"a":1,"\\u0061":2}',
    '{"outer":[{"same":1,"same":2}]}',
  ])("rejects duplicate decoded keys: %s", (text) => {
    expect(() => parseUniqueJson(text)).toThrow("Duplicate JSON object key");
    expect(rawAuditProblems(child(text, { status: 0 })).length).toBeGreaterThan(
      0,
    );
  });

  it("retains valid nested values and keys that differ between objects", () => {
    const text =
      '{"a":{"x":1},"b":[{"x":2},"escaped\\\"key",null,true,-2.5e2]}';
    expect(parseUniqueJson(text)).toEqual(JSON.parse(text));
  });

  it("rejects malformed, oversized and deeply nested input", () => {
    expect(() => parseUniqueJson('{"a":}')).toThrow();
    expect(() =>
      parseUniqueJson('"' + "a".repeat(16 * 1024 * 1024) + '"'),
    ).toThrow("bound");
    expect(() =>
      parseUniqueJson("[".repeat(130) + "0" + "]".repeat(130)),
    ).toThrow("depth");
  });

  it("rejects duplicate advisory identities rather than overwriting findings", () => {
    expect(
      rawAuditProblems(
        child({ braces: [advisory(), advisory({ severity: "low" })] }),
      ),
    ).not.toEqual([]);
  });

  it("rejects duplicate valid report keys instead of accepting the last clean value", () => {
    const text =
      '{"braces":' +
      JSON.stringify([advisory()]) +
      ',"braces":' +
      JSON.stringify([advisory({ severity: "low" })]) +
      "}";
    expect(rawAuditProblems(child(text, { status: 1 }))).toEqual([
      "bun audit output is not JSON",
    ]);
  });
});

describe("owned Bun audit child (inert fake executable; no registry calls)", () => {
  const dir = mkdtempSync(join(tmpdir(), "t03-bun-audit-child-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const executable = (name: string, body: string) => {
    const path = join(dir, name);
    writeFileSync(path, `#!${process.execPath}\n${body}\n`);
    chmodSync(path, 0o700);
    return path;
  };

  it("isolates global config, disables dotenv and removes the owned home after exit", async () => {
    const path = executable(
      "isolated",
      'process.stdout.write("{}"); process.stderr.write(JSON.stringify({args:process.argv.slice(2),home:process.env.HOME,xdg:process.env.XDG_CONFIG_HOME,keys:Object.keys(process.env)}));',
    );
    const result = await runBunAudit(path, dir, true);
    expect(result.status).toBe(0);
    const metadata = JSON.parse(result.stderr);
    expect(metadata.args).toEqual([
      "--no-env-file",
      "audit",
      "--json",
      "--prod",
    ]);
    expect(metadata.home).toBe(metadata.xdg);
    expect(metadata.home).not.toBe(process.env.HOME);
    expect(existsSync(metadata.home)).toBe(false);
    // Darwin's process launcher may inject this OS text-encoding variable.
    expect(
      metadata.keys
        .filter((key: string) => key !== "__CF_USER_TEXT_ENCODING")
        .sort(),
    ).toEqual(["HOME", "NO_COLOR", "PATH", "XDG_CONFIG_HOME"].sort());
    expect(rawAuditProblems(result)).toEqual([]);
  });

  it.each(["stdout", "stderr"] as const)(
    "rejects excessive %s even if the child intends to exit zero",
    async (stream) => {
      const path = executable(
        `overflow-${stream}`,
        `process.${stream}.write(" ".repeat(${AUDIT_OUTPUT_LIMIT + 1}),()=>process.exit(0));`,
      );
      const result = await runBunAudit(path, dir, false);
      expect(result.outputExceeded).toBe(true);
      expect(Buffer.byteLength(result[stream])).toBeLessThanOrEqual(
        AUDIT_OUTPUT_LIMIT,
      );
      expect(rawAuditProblems(result)).toEqual([
        "bun audit output exceeded the supported bound",
      ]);
    },
  );

  it.each(["stdout", "stderr"] as const)(
    "decodes a UTF-8 character split across %s chunks without replacement",
    async (stream) => {
      // `é` is 0xC3 0xA9; the delay delivers its two bytes in separate chunks.
      const path = executable(
        `split-${stream}`,
        `process.${stream}.write(Buffer.from([0x7b,0x22,0xc3]));setTimeout(()=>process.${stream}.write(Buffer.from([0xa9,0x22,0x3a,0x31,0x7d])),100);`,
      );
      const result = await runBunAudit(path, dir, false);
      expect(result.outputExceeded).toBe(false);
      expect(result[stream]).toBe('{"é":1}');
    },
  );

  it("bounds raw bytes exactly: multibyte output at the limit is retained", async () => {
    const path = executable(
      "at-limit",
      `process.stdout.write("é".repeat(${AUDIT_OUTPUT_LIMIT / 2}),()=>process.exit(0));`,
    );
    const result = await runBunAudit(path, dir, false);
    expect(result.outputExceeded).toBe(false);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("é".repeat(AUDIT_OUTPUT_LIMIT / 2));
  });

  it("fails closed and cleans up when the executable cannot start", async () => {
    const result = await runBunAudit(join(dir, "absent"), dir, false);
    expect(result.spawnError).toBeTruthy();
    expect(rawAuditProblems(result)[0]).toContain("could not start");
  });
});
