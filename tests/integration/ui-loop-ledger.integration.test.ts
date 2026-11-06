import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

const cli = join(process.cwd(), "scripts/ui-loop/ledger.mjs");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ui-ledger-")));
  roots.push(root);
  const directory = join(
    root,
    "docs/plans/ui-improvement-loop-2026-11-04/stages/s1",
  );
  mkdirSync(directory, { recursive: true });
  const ledger = join(directory, "ledger.json");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const audit = join(root, "output/ui-loop/s1/loop-1");
  mkdirSync(audit, { recursive: true });
  writeFileSync(
    join(audit, "audit-sol.json"),
    JSON.stringify({
      stageScore: 9,
      stageMedian: 9,
      screens: [{ id: "shell-page", score: 9 }],
    }),
  );
  return {
    root,
    ledger,
    run: (hook?: string) =>
      spawnSync(
        process.execPath,
        [
          ...(hook ? ["--import", hook] : []),
          cli,
          "--stage",
          "1",
          "--loop",
          "1",
          "--commit",
          "tested-head",
        ],
        { cwd: root, encoding: "utf8", env: { PATH: bin, NODE_ENV: "test" } },
      ),
  };
}

it("creates a ledger when no earlier ledger or optional Opus audit exists", () => {
  const probe = fixture();
  const result = probe.run();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(probe.ledger, "utf8"))).toMatchObject({
    stage: 1,
    loops: [{ loop: 1, commit: "tested-head", scores: { sol: { min: 9 } } }],
  });
});

it("does not overwrite a different file when the ledger path is replaced after reading", () => {
  const probe = fixture();
  writeFileSync(
    probe.ledger,
    JSON.stringify({ stage: 1, loops: [{ loop: 0, note: "keep" }] }),
  );
  const external = join(probe.root, "other-file.json");
  writeFileSync(external, "leave this file unchanged");
  const hook = join(probe.root, "swap-after-read.mjs");
  writeFileSync(
    hook,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
const target = ${JSON.stringify(probe.ledger)};
const external = ${JSON.stringify(external)};
const read = fs.readFileSync;
let swapped = false;
fs.readFileSync = function(path, ...options) {
  const content = read.call(this, path, ...options);
  if (!swapped && typeof path === 'string' && resolve(path) === target) {
    swapped = true;
    fs.unlinkSync(target);
    fs.symlinkSync(external, target);
  }
  return content;
};
syncBuiltinESMExports();
`,
  );
  const result = probe.run(hook);
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(external, "utf8")).toBe("leave this file unchanged");
  expect(lstatSync(probe.ledger).isSymbolicLink()).toBe(false);
  const ledger = JSON.parse(readFileSync(probe.ledger, "utf8"));
  expect(ledger.loops).toHaveLength(2);
  expect(ledger.loops[0]).toEqual({ loop: 0, note: "keep" });
  expect(ledger.loops[1].scores.sol.min).toBe(9);
});

it("leaves malformed existing evidence untouched instead of treating it as missing", () => {
  const probe = fixture();
  writeFileSync(probe.ledger, "{malformed");
  expect(probe.run().status).not.toBe(0);
  expect(readFileSync(probe.ledger, "utf8")).toBe("{malformed");
});
