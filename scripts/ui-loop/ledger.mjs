#!/usr/bin/env node
// Adds or updates one loop in docs/plans/…/stages/s<N>/ledger.json.
//
//   node scripts/ui-loop/ledger.mjs --stage 1 --loop 1 [--commit <sha>] [--entry triage.json]
//
// Scores come from the audit files in output/ui-loop/s<N>/loop-<k>/ (audit-sol.json,
// else audit-sol-a.json; audit-opus.json). --entry merges extra fields such as
// fixed, rejected, deferred, behaviour, checks and note.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    stage: { type: "string" },
    loop: { type: "string" },
    commit: { type: "string" },
    entry: { type: "string" },
  },
});
const path = `docs/plans/ui-improvement-loop-2026-11-04/stages/s${args.stage}/ledger.json`;
const ledger = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { stage: Number(args.stage), loops: [] };
const dir = resolve(`output/ui-loop/s${args.stage}/loop-${args.loop}`);
const audit = (names) => {
  for (const n of names) {
    const p = join(dir, n);
    if (!existsSync(p)) continue;
    const a = JSON.parse(readFileSync(p, "utf8"));
    return {
      min: a.stageScore,
      median: a.stageMedian,
      screens: Object.fromEntries(a.screens.map((s) => [s.id, s.score])),
    };
  }
  return undefined;
};
const loop = Number(args.loop);
const previous = ledger.loops.find((l) => l.loop === loop) ?? { loop };
const entry = {
  ...previous,
  ...(args.commit ? { commit: args.commit } : {}),
  scores: {
    ...previous.scores,
    ...Object.fromEntries(
      [
        ["sol", audit(["audit-sol.json", "audit-sol-a.json"])],
        ["opus", audit(["audit-opus.json"])],
      ].filter(([, v]) => v),
    ),
  },
  ...(args.entry ? JSON.parse(readFileSync(args.entry, "utf8")) : {}),
};
ledger.loops = [...ledger.loops.filter((l) => l.loop !== loop), entry].sort(
  (a, b) => a.loop - b.loop,
);
writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(
  `loop ${loop}: sol ${entry.scores.sol?.min ?? "–"}/${entry.scores.sol?.median ?? "–"}, opus ${entry.scores.opus?.min ?? "–"}/${entry.scores.opus?.median ?? "–"} → ${path}`,
);
