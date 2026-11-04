#!/usr/bin/env node
// Blind UI audit for one capture (docs/plans/ui-improvement-loop-2026-11-04).
//
//   node scripts/ui-loop/audit.mjs --stage 1 --loop 0 --auditor sol [--run b]
//   node scripts/ui-loop/audit.mjs --stage 1 --loop 0 --auditor opus --prompt-only
//   node scripts/ui-loop/audit.mjs --stage 1 --loop 0 --auditor opus --score <raw.json>
//
// sol runs gpt-6.1-sol through `codex exec` (≤ 12 images per call, groups in
// parallel). opus writes the same prompts for Opus subagents, and --score turns
// their raw JSON into the scored audit. Scores are computed here from the
// rubric's caps, never taken from the model.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
const { values: args } = parseArgs({
  options: {
    stage: { type: "string" },
    loop: { type: "string" },
    auditor: { type: "string", default: "sol" },
    run: { type: "string", default: "" },
    "group-size": { type: "string", default: "12" },
    "prompt-only": { type: "boolean", default: false },
    score: { type: "string", multiple: true },
    dir: { type: "string" },
  },
});
const PLAN = "docs/plans/ui-improvement-loop-2026-11-04";
const dir = resolve(
  args.dir ?? `output/ui-loop/s${args.stage}/loop-${args.loop}`,
);
const captures = JSON.parse(readFileSync(join(dir, "captures.json"), "utf8"));
const spec = JSON.parse(
  readFileSync(`${PLAN}/stages/s${args.stage}/screens.json`, "utf8"),
);
const suffix = `${args.auditor}${args.run ? `-${args.run}` : ""}`;

// Benchmark sections per stage: module section, its rubric anchors, cross-cutting.
const MODULE = { 1: 5, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4 }[args.stage];
const research = readFileSync(
  "docs/research/ui-competitive-benchmark-2026-11-04.md",
  "utf8",
);
const section = (heading) => {
  const start = research.indexOf(heading);
  if (start < 0) throw Error(`Missing benchmark heading ${heading}`);
  const level = heading.trim().match(/^#+/)[0].length;
  const rest = research.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return research.slice(
    start,
    start + heading.length + (next < 0 ? rest.length : next),
  );
};
const benchmark = [
  section(`\n## ${MODULE}. `).trim(),
  section(`\n### ${MODULE}. `).trim(),
  section("\n### Cross-cutting anchors").trim(),
].join("\n\n");

function prompt(group) {
  const blocks = group.map(({ screen, shots }) => {
    const lines = shots.map(
      (r) =>
        `  - image #${r.imageIndex}: ${r.name}.png (${r.viewport === "mobile" ? "390×844 phone, 2× pixels" : "1440×900 desktop"}, ${r.locale}, ${r.theme}). URL ${r.url}. Page overflow ${r.overflowPx}px. Console errors: ${r.consoleErrors.length ? r.consoleErrors.join(" | ").slice(0, 300) : "none"}. axe: ${
          (r.axe ?? [])
            .map(
              (v) =>
                `${v.id} [${v.impact}] ×${v.count} (${v.nodes.slice(0, 2).join(", ")})`,
            )
            .join("; ") || "no violations"
        }. Accessibility snapshot: ${join(dir, `${r.name}.aria.yml`)}`,
    );
    return `### Screen \`${screen.id}\`: ${screen.title} (state: ${screen.state})\n${lines.join("\n")}`;
  });
  return `You are an independent senior UI auditor for Yongkit (โยงกิจ), a Thai-first industrial web app (Next.js). This is a blind audit: you have no implementer notes and no earlier scores. Judge only what the evidence shows.

Stage ${args.stage}: ${spec.title}. Module: ${spec.module}.

## Read first (read-only; you may open any file in this repository)
- Rubric (binding): ${PLAN}/rubric.md
- Accepted decisions (do not score these down): ${PLAN}/decisions.md
- Product context: PRODUCT.md
- Design system: docs/plans/design-system.md
- Source for these screens: ${spec.sources.join(", ")}. Use it to confirm a finding and to cite file:line, not to imagine UI that is not captured.

## Benchmark for this module (from docs/research/ui-competitive-benchmark-2026-11-04.md)
Patterns tagged [S] are search-excerpt only: never the sole reason for a finding.

${benchmark}

## Screens and attached images
Images are attached in the order of their numbers. The phone captures are 2× pixel density.

${blocks.join("\n\n")}

## What to return
For every screen above, in the JSON schema you were given:
- \`dimensions\`: the seven rubric dimensions, each 1–10, judged across all of that screen's images.
- \`findings\`: every real problem, with rubric severity. \`evidence\` names the image file and region, an accessibility node, or a source file:line. \`fix\` is concrete and uses the app's existing components and tokens. \`benchmark\` names the reference product and pattern when the finding comes from the comparison, else "".
  - type "ui" for UI defects; "behaviour" for data-rule or flow changes (they go to the product owner); "coverage" when a needed state is not captured.
  - Do not report P3 nits unless there is nothing else on the screen.
  - Do not report the Next.js dev tooling, seeded demo names, or anything in decisions.md.
- \`bestReference\`: the benchmark product this screen matches or beats for its task, or "" if none. Only name one if it is true.
- \`reachesNineIf\`: one sentence on what is still missing for a 9.
Put cross-screen observations (shared shell issues, inconsistencies between screens) in \`notes\`, and also file them as findings on the screen where they show most.
Be strict: 9 means you would ship it next to the best reference product without apology.`;
}

function score(screen) {
  const dims = Object.values(screen.dimensions);
  const average = dims.reduce((s, d) => s + d, 0) / dims.length;
  const ui = screen.findings.filter((f) => f.type === "ui");
  const n = (sev) => ui.filter((f) => f.severity === sev).length;
  const [p0, p1, p2] = [n("P0"), n("P1"), n("P2")];
  let cap = p0 ? 4 : p1 >= 2 ? 6 : p1 === 1 ? 7 : p2 >= 3 ? 8 : 9;
  if (cap === 9 && p2 === 0 && screen.bestReference.trim()) cap = 10;
  return {
    ...screen,
    average: Math.round(average * 10) / 10,
    cap,
    score: Math.min(Math.round(average), cap),
  };
}

function finish(raws) {
  const screens = raws.flatMap((r) => r.screens).map(score);
  const known = new Set(spec.screens.map((s) => s.id));
  const scored = screens.filter((s) => known.has(s.id));
  let counter = 0;
  for (const s of scored)
    for (const f of s.findings)
      f.id = `S${args.stage}-L${args.loop}-${args.auditor}${args.run}-${String(++counter).padStart(2, "0")}`;
  const values = scored.map((s) => s.score).sort((a, b) => a - b);
  const missing = [...known].filter((id) => !scored.some((s) => s.id === id));
  const audit = {
    auditor: args.auditor === "sol" ? "gpt-6.1-sol" : "opus-5.5",
    stage: Number(args.stage),
    loop: args.loop,
    capturedAt: captures.capturedAt,
    screens: scored,
    missing,
    stageScore: values[0],
    stageMedian: values[Math.floor(values.length / 2)],
    notes: raws.map((r) => r.notes).filter(Boolean),
  };
  const path = join(dir, `audit-${suffix}.json`);
  writeFileSync(path, `${JSON.stringify(audit, null, 2)}\n`);
  for (const s of scored) {
    const sev = ["P0", "P1", "P2", "P3"]
      .map(
        (p) =>
          `${p}:${s.findings.filter((f) => f.type === "ui" && f.severity === p).length}`,
      )
      .join(" ");
    console.log(
      `${String(s.score).padStart(2)}  (avg ${s.average}, cap ${s.cap})  ${s.id.padEnd(22)} ${sev}`,
    );
  }
  console.log(
    `stage min ${audit.stageScore}, median ${audit.stageMedian}${missing.length ? `, MISSING ${missing.join(",")}` : ""} → ${path}`,
  );
}

// Group screens so that each call carries ≤ group-size images.
const ok = captures.results.filter((r) => !r.error);
const groups = [];
let current = [];
let count = 0;
for (const screen of spec.screens) {
  const shots = ok.filter((r) => r.screen === screen.id);
  if (!shots.length) continue;
  if (count + shots.length > Number(args["group-size"]) && current.length) {
    groups.push(current);
    current = [];
    count = 0;
  }
  current.push({ screen, shots });
  count += shots.length;
}
if (current.length) groups.push(current);
for (const group of groups) {
  let i = 0;
  for (const g of group) for (const r of g.shots) r.imageIndex = ++i;
}

if (args.score) {
  finish(args.score.map((p) => JSON.parse(readFileSync(p, "utf8"))));
} else if (args["prompt-only"] || args.auditor !== "sol") {
  groups.forEach((group, k) => {
    const images = group.flatMap((g) =>
      g.shots.map((r) => join(dir, `${r.name}.png`)),
    );
    const path = join(dir, `prompt-${suffix}-g${k + 1}.md`);
    writeFileSync(
      path,
      `${prompt(group)}\n\n## Images (read each one, in order)\n${images.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\n## Output\nReturn only JSON matching ${join(root, "scripts/ui-loop/audit.schema.json")}.\n`,
    );
    console.log(path);
  });
} else {
  const runs = groups.map(
    (group, k) =>
      new Promise((done, fail) => {
        const out = join(dir, `raw-${suffix}-g${k + 1}.json`);
        if (existsSync(out)) return done(out);
        const images = group.flatMap((g) =>
          g.shots.flatMap((r) => ["-i", join(dir, `${r.name}.png`)]),
        );
        const child = spawn(
          "codex",
          [
            "exec",
            "-c",
            'model="gpt-6.1-sol"',
            "-c",
            'model_reasoning_effort="high"',
            "-s",
            "read-only",
            "-C",
            root,
            ...images,
            "--output-schema",
            join(root, "scripts/ui-loop/audit.schema.json"),
            "-o",
            out,
            "-",
          ],
          { stdio: ["pipe", "ignore", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d));
        child.stdin.end(prompt(group));
        const timer = setTimeout(() => child.kill("SIGTERM"), 30 * 60_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0 && existsSync(out)) done(out);
          else
            fail(
              Error(
                `codex group ${k + 1} exited ${code}: ${stderr.slice(-800)}`,
              ),
            );
        });
      }),
  );
  const outs = await Promise.all(runs);
  finish(outs.map((p) => JSON.parse(readFileSync(p, "utf8"))));
}
