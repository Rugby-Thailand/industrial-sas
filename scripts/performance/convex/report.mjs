#!/usr/bin/env node
// Renders a profile JSON as a Markdown table: node report.mjs output/perf/<label>.json [compare.json]
import { readFileSync } from "node:fs";
const [file, compareFile] = process.argv.slice(2);
const report = JSON.parse(readFileSync(file, "utf8"));
const compare = compareFile
  ? JSON.parse(readFileSync(compareFile, "utf8"))
  : null;
const key = (q) => `${q.fn}|${q.label}`;
const before = new Map(
  (compare?.queries ?? []).map((q) => [
    key(q),
    q.targets.candidate ?? Object.values(q.targets)[0],
  ]),
);
const kb = (bytes) =>
  bytes === null || bytes === undefined ? "–" : (bytes / 1024).toFixed(1);
const lines = [
  `Profile \`${report.label}\` · ${report.generatedAt} · ${report.samples} uncached samples per target (p50) · dataset ${JSON.stringify(report.dataset)}`,
  `Targets: ${report.targets.map((t) => `${t.name}@${t.revision.slice(0, 8)}${t.dirty ? "+dirty" : ""}`).join(", ")} · load avg before/after ${report.loadAverage.before[0].toFixed(1)}/${report.loadAverage.after[0].toFixed(1)}`,
  "",
  `| Screen | Function | Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note |`,
  `|---|---|---:|---:|---:|---:|---:|---:|---|`,
];
for (const q of [...report.queries].sort(
  (a, b) =>
    (b.targets.candidate.readDocs ?? 0) - (a.targets.candidate.readDocs ?? 0),
)) {
  const c = q.targets.candidate;
  const b = q.targets.base;
  const prior = before.get(key(q));
  const delta =
    prior && prior.readDocs !== c.readDocs ? ` (was ${prior.readDocs})` : "";
  lines.push(
    `| ${q.screen} | \`${q.fn}\`${q.label ? ` (${q.label})` : ""} | ${c.readDocs}${delta} | ${kb(c.readBytes)} | ${c.execMsP50} | ${b?.execMsP50 ?? "–"} | ${c.requests} | ${kb(c.returnBytes)} | ${[q.legacy ? "legacy (no live subscriber)" : "", c.resultCode ?? c.lastError ?? ""].filter(Boolean).join("; ")} |`,
  );
}
for (const [name, data] of Object.entries(report.perTarget ?? {})) {
  lines.push(
    "",
    `**${name}: write flows**`,
    "",
    "| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |",
    "|---|---|---:|---:|---:|---:|",
  );
  for (const flow of data.flows)
    for (const step of flow.steps)
      lines.push(
        `| ${flow.flow} | \`${step.fn}\` | ${step.readDocs} | ${step.writeDocs} | ${step.writeIndexRows} | ${step.execMsP50} |`,
      );
  lines.push(
    "",
    `**${name}: reactive fan-out** (${data.fanout[0]?.subscriptions ?? 0} subscriptions open on one session)`,
    "",
    "| Write | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Re-run functions |",
    "|---|---:|---:|---:|---:|---|",
  );
  for (const row of data.fanout)
    lines.push(
      `| ${row.write}${row.error ? ` (error: ${row.error})` : ""} | ${row.reruns} | ${row.readDocs} | ${kb(row.readBytes)} | ${row.execMs} | ${Object.entries(
        row.byFunction,
      )
        .map(([fn, r]) => `${fn}×${r.reruns} (${r.readDocs} docs)`)
        .join("; ")} |`,
    );
  for (const row of [data.contention ?? []].flat())
    lines.push(
      "",
      `**${name}: contention** ${row.workers} concurrent ${row.name ?? "saveJobScans"} → executions ${row.executions}, OCC retries ${row.occRetries}, failures ${row.failed}, RTT p50 ${row.rttMsP50} ms / max ${row.rttMsMax} ms`,
    );
}
console.log(lines.join("\n"));
