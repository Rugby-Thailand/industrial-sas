import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ci-actionlint-cache-test-"));
  fixtures.push(root);
  for (const directory of [
    "scripts/ci",
    ".github/workflows",
    "temp",
    "archive",
  ])
    mkdirSync(join(root, directory), { recursive: true });
  cpSync(
    join(process.cwd(), "scripts/ci/validate-workflows.mjs"),
    join(root, "scripts/ci/validate-workflows.mjs"),
  );
  writeFileSync(join(root, ".github/workflows/test.yml"), "name: test\n");
  writeFileSync(join(root, "scripts/ci/dependency-exceptions.json"), "[]");
  const output = join(root, "executed.json");
  const malicious = join(root, "untrusted-executed");
  writeFileSync(
    join(root, "archive/actionlint"),
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({binary:process.argv[1],cwd:process.cwd()}));\n`,
    { mode: 0o700 },
  );
  const archive = join(root, "verified.tar.gz");
  execFileSync("tar", [
    "-czf",
    archive,
    "-C",
    join(root, "archive"),
    "actionlint",
  ]);
  const bytes = readFileSync(archive);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const version = "test-1";
  const asset = {
    name: "actionlint_test.tar.gz",
    sha256,
    url: "https://github.com/rhysd/actionlint/releases/download/test/actionlint_test.tar.gz",
  };
  // Only immutable tool metadata/policy inputs are stubbed. The actual CLI
  // download/checksum/cache/extract/execute/cleanup implementation runs intact.
  writeFileSync(
    join(root, "scripts/ci/workflow-lib.mjs"),
    `export const ACTIONLINT = ${JSON.stringify({ version })};
export const actionlintAsset = () => (${JSON.stringify(asset)});
export const actionReferences = () => [];
export const normalizeConcurrencyQueue = (_name, text) => ({text,problems:[]});
export const tagCommit = () => null;
export const workflowPolicyProblems = () => [];
`,
  );
  writeFileSync(
    join(root, "preload.mjs"),
    `import fs from 'node:fs';
globalThis.fetch = async () => {
  fs.appendFileSync('fetch-calls', 'fetch\\n');
  return new Response(fs.readFileSync('response.bin'), {status:200});
};
`,
  );
  writeFileSync(join(root, "response.bin"), bytes);
  const cache = join(root, "temp", `actionlint-${version}-${sha256}.tar.gz`);
  const oldCache = join(
    root,
    "temp",
    `actionlint-${version}-${sha256.slice(0, 16)}`,
  );
  const run = () =>
    spawnSync(
      process.execPath,
      ["--import", "./preload.mjs", "scripts/ci/validate-workflows.mjs"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH,
          TMPDIR: join(root, "temp"),
        },
      },
    );
  const poison = `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(malicious)},'executed');\n`;
  return { root, bytes, cache, oldCache, output, malicious, poison, run };
}

describe("actionlint verified archive cache", () => {
  it("ignores a modified cached executable and runs a freshly extracted verified binary", () => {
    const probe = fixture();
    mkdirSync(probe.oldCache);
    writeFileSync(join(probe.oldCache, "actionlint_test.tar.gz"), probe.bytes);
    writeFileSync(join(probe.oldCache, "actionlint"), probe.poison, {
      mode: 0o700,
    });
    writeFileSync(probe.cache, probe.bytes);
    const result = probe.run();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(probe.malicious)).toBe(false);
    const execution = JSON.parse(readFileSync(probe.output, "utf8")) as {
      binary: string;
      cwd: string;
    };
    expect(execution.binary).toContain("actionlint-workflows-");
    expect(execution.binary).toContain("actionlint-binary-");
    expect(existsSync(execution.binary)).toBe(false);
    expect(existsSync(execution.cwd)).toBe(false);
    expect(existsSync(join(probe.root, "fetch-calls"))).toBe(false);
  });

  it("rejects changed download bytes before caching, extraction or execution", () => {
    const probe = fixture();
    writeFileSync(probe.cache, "tampered cached archive");
    writeFileSync(join(probe.root, "response.bin"), "untrusted download");
    const result = probe.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("actionlint checksum mismatch");
    expect(existsSync(probe.output)).toBe(false);
    expect(readFileSync(probe.cache, "utf8")).toBe("tampered cached archive");
    expect(readdirSync(join(probe.root, "temp"))).toEqual([
      probe.cache.split("/").at(-1),
    ]);
  });

  it("replaces a cache leaf symlink atomically without modifying its target", () => {
    const probe = fixture();
    const outside = join(probe.root, "outside-file");
    writeFileSync(outside, "untouched outside sentinel");
    symlinkSync(outside, probe.cache);
    const result = probe.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(outside, "utf8")).toBe("untouched outside sentinel");
    expect(readFileSync(probe.cache)).toEqual(probe.bytes);
    expect(readdirSync(join(probe.root, "temp"))).toEqual([
      probe.cache.split("/").at(-1),
    ]);
  });
});
