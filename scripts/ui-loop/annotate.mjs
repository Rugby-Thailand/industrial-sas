#!/usr/bin/env node
// Annotated before/after sets for the UI improvement loop.
//
//   node scripts/ui-loop/annotate.mjs --stage 1 --loop 3 --before 1 [--title "…"]
//
// Before images come from output/ui-loop/s<N>/loop-<before>/, after images and
// marker boxes from loop-<loop>/captures.json (capture.mjs records a box for
// every change in changes-*.json, including --changes-from loops). Writes one
// JPEG per changed screen and viewport to the stage's annotated/ folder, then
// rebuilds the stage gallery (index.html) from ledger.json and those files.
import { chromium } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
const { values: args } = parseArgs({
  options: {
    stage: { type: "string" },
    loop: { type: "string" },
    before: { type: "string" },
    title: { type: "string", default: "" },
    "gallery-only": { type: "boolean", default: false },
  },
});
const N = args.stage;
const PLAN = "docs/plans/ui-improvement-loop-2026-11-04";
const stageDir = `${PLAN}/stages/s${N}`;
const annotatedDir = join(stageDir, "annotated");
mkdirSync(annotatedDir, { recursive: true });
const spec = JSON.parse(readFileSync(join(stageDir, "screens.json"), "utf8"));
const loopDir = (k) => resolve(`output/ui-loop/s${N}/loop-${k}`);
const esc = (t) =>
  String(t ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** Scores per screen for one loop: { sol: {id: score}, opus: {id: score} }. */
function scores(k) {
  const dir = loopDir(k);
  const read = (names) => {
    for (const n of names) {
      const p = join(dir, n);
      if (existsSync(p)) {
        const a = JSON.parse(readFileSync(p, "utf8"));
        return Object.fromEntries(a.screens.map((s) => [s.id, s.score]));
      }
    }
    return {};
  };
  return {
    sol: read(["audit-sol.json", "audit-sol-a.json"]),
    opus: read(["audit-opus.json"]),
  };
}

/** Every finding from every audit in this stage, by id. */
function allFindings() {
  const base = resolve(`output/ui-loop/s${N}`);
  const map = new Map();
  for (const d of readdirSync(base).filter((d) => d.startsWith("loop-")))
    for (const f of readdirSync(join(base, d)).filter((f) =>
      /^audit-.*\.json$/.test(f),
    )) {
      const a = JSON.parse(readFileSync(join(base, d, f), "utf8"));
      for (const s of a.screens)
        for (const x of s.findings) map.set(x.id, { ...x, auditor: a.auditor });
    }
  return map;
}

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f5f7; font: 15px/1.45 -apple-system, "Sukhumvit Set", Thonburi, "Helvetica Neue", sans-serif; color: #17202e; }
  .sheet { display: inline-block; padding: 28px 32px 32px; background: #f4f5f7; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .meta { color: #5b6473; margin-bottom: 18px; }
  .score { display: inline-block; margin-right: 14px; padding: 2px 10px; border-radius: 999px; background: #fff; border: 1px solid #d6dae1; font-weight: 600; }
  .score b { color: #0f7a3d; }
  .cols { display: flex; gap: 28px; align-items: flex-start; }
  .col h2 { margin: 0 0 8px; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; color: #5b6473; }
  .frame { position: relative; border: 1px solid #c9ced6; border-radius: 10px; overflow: hidden; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .frame img { display: block; }
  .frame svg { position: absolute; inset: 0; }
  ol { margin: 22px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
  li { display: grid; grid-template-columns: 30px 1fr; gap: 10px; background: #fff; border: 1px solid #d6dae1; border-radius: 10px; padding: 10px 14px; }
  .n { width: 26px; height: 26px; border-radius: 50%; background: #e8590c; color: #fff; font-weight: 700; display: grid; place-items: center; font-size: 14px; }
  .n.off { background: #8a93a3; }
  .what { font-weight: 600; }
  .why { color: #3d4654; }
  .ids { color: #5b6473; font-size: 13px; }
`;

function compose(screen, vp, beforeImg, after, items, sc) {
  const scale = vp === "mobile" ? 1 : 0.5;
  const w = (vp === "mobile" ? 390 : 1440) * scale;
  const h = (vp === "mobile" ? 844 : 900) * scale;
  const markers = items
    .map((it, i) => {
      if (!it.box) return "";
      const { x, y, width, height } = it.box;
      const [bx, by, bw, bh] = [x, y, width, height].map((v) => v * scale);
      if (by > h || bx > w || by + bh < 0) return "";
      const cx = Math.min(Math.max(bx + bw, 14), w - 14);
      const cy = Math.min(Math.max(by, 14), h - 14);
      return `<rect x="${bx - 2}" y="${by - 2}" width="${bw + 4}" height="${bh + 4}" rx="6" fill="none" stroke="#e8590c" stroke-width="3"/>
        <circle cx="${cx}" cy="${cy}" r="13" fill="#e8590c" stroke="#fff" stroke-width="2"/>
        <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${i + 1}</text>`;
    })
    .join("");
  const scoreLine = ["sol", "opus"]
    .filter((a) => sc.after[a]?.[screen.id] !== undefined)
    .map(
      (a) =>
        `<span class="score">${a === "sol" ? "gpt-6.1-sol" : "Opus 5.5"}: ${sc.before[a]?.[screen.id] ?? "–"} → <b>${sc.after[a][screen.id]}</b></span>`,
    )
    .join("");
  const legend = items
    .map((it, i) => {
      const visible = Boolean(it.box) && it.box.y * scale < h;
      return `<li><span class="n${visible ? "" : " off"}">${i + 1}</span><div>
        <div class="what">${esc(it.summary)}${visible ? "" : " <span class='ids'>(not visible in this capture)</span>"}</div>
        <div class="why">Why: ${esc(it.why)}</div>
        <div class="ids">${esc(it.source)}</div></div></li>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div class="sheet" id="sheet">
    <h1>${esc(screen.title)}</h1>
    <div class="meta">Stage ${N} · loop ${args.before} → ${args.loop}${args.title ? ` · ${esc(args.title)}` : ""} · ${vp === "mobile" ? "Phone 390 × 844" : "Desktop 1440 × 900 (shown at 50%)"} · Thai, light</div>
    <div>${scoreLine}</div>
    <div class="cols" style="margin-top:14px">
      <div class="col"><h2>Before · loop ${args.before}</h2><div class="frame" style="width:${w}px;height:${h}px"><img src="${beforeImg}" width="${w}" height="${h}"></div></div>
      <div class="col"><h2>After · loop ${args.loop}</h2><div class="frame" style="width:${w}px;height:${h}px"><img src="${after}" width="${w}" height="${h}"><svg width="${w}" height="${h}">${markers}</svg></div></div>
    </div>
    <ol style="max-width:${w * 2 + 28}px">${legend}</ol>
  </div></body></html>`;
}

function gallery() {
  const ledgerPath = join(stageDir, "ledger.json");
  const ledger = existsSync(ledgerPath)
    ? JSON.parse(readFileSync(ledgerPath, "utf8"))
    : { loops: [] };
  const files = readdirSync(annotatedDir)
    .filter((f) => f.endsWith(".jpg"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const byLoop = Map.groupBy(files, (f) => f.match(/^loop-(\d+)/)[1]);
  const rows = ledger.loops
    .map(
      (l) =>
        `<tr><td>${l.loop}</td><td><code>${esc(l.commit?.slice(0, 8) ?? "")}</code></td><td>${l.scores?.sol?.min ?? "–"} / ${l.scores?.sol?.median ?? "–"}</td><td>${l.scores?.opus?.min ?? "–"} / ${l.scores?.opus?.median ?? "–"}</td><td>${(l.fixed ?? []).length}</td><td>${esc(l.note ?? "")}</td></tr>`,
    )
    .join("");
  const sets = [...byLoop.entries()]
    .reverse()
    .map(
      ([k, fs]) =>
        `<section><h2>Loop ${k}</h2><div class="grid">${fs.map((f) => `<a href="annotated/${f}"><img loading="lazy" src="annotated/${f}" alt="${esc(f)}"></a>`).join("")}</div></section>`,
    )
    .join("");
  writeFileSync(
    join(stageDir, "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Stage ${N}: ${esc(spec.title)}: UI loop gallery</title>
    <style>
      body { margin: 0 auto; max-width: 1200px; padding: 24px; font: 15px/1.5 -apple-system, "Sukhumvit Set", "Helvetica Neue", sans-serif; color: #17202e; }
      table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #d6dae1; }
      .grid { display: grid; gap: 16px; } .grid img { width: 100%; border: 1px solid #d6dae1; border-radius: 8px; }
    </style>
  </head>
  <body>
    <h1>Stage ${N}: ${esc(spec.title)}</h1>
    <p>Score = lowest screen score (min) / median, per auditor. Gate: every screen ≥ 9 with gpt-6.1-sol, then with both auditors.</p>
    <table><thead><tr><th>Loop</th><th>Commit</th><th>gpt-6.1-sol min / median</th><th>Opus 5.5 min / median</th><th>Fixes</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
    ${sets}
  </body>
</html>
`,
  );
}

if (!args["gallery-only"]) {
  const afterDir = loopDir(args.loop);
  const beforeDir = loopDir(args.before);
  const captures = JSON.parse(
    readFileSync(join(afterDir, "captures.json"), "utf8"),
  );
  const findings = allFindings();
  const sc = { before: scores(args.before), after: scores(args.loop) };
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1.5 });
  let written = 0;
  for (const r of captures.results.filter((r) => r.boxes?.length)) {
    const screen = spec.screens.find((s) => s.id === r.screen);
    const beforePng = join(beforeDir, `${r.name}.png`);
    if (!screen || !existsSync(beforePng)) continue;
    const changes = [
      afterDir,
      ...readdirSync(resolve(`output/ui-loop/s${N}`))
        .filter((d) => d.startsWith("loop-"))
        .map((d) => resolve(`output/ui-loop/s${N}`, d)),
    ]
      .filter((d, i, a) => a.indexOf(d) === i)
      .flatMap((d) =>
        readdirSync(d)
          .filter((f) => /^changes-.*\.json$/.test(f))
          .flatMap((f) => JSON.parse(readFileSync(join(d, f), "utf8"))),
      );
    const items = r.boxes.map((b) => {
      const c = changes.find(
        (c) => c.screen === r.screen && c.locator === b.locator,
      );
      const refs = (c?.findingIds ?? []).map((id) => findings.get(id));
      const auditors = [
        ...new Set(refs.filter(Boolean).map((f) => f.auditor)),
      ].join(" + ");
      const bench = refs.find((f) => f?.benchmark)?.benchmark;
      return {
        box: b.box,
        summary: c?.summary ?? b.locator,
        why: c?.why ?? "",
        source: `${(c?.findingIds ?? []).join(", ")}${auditors ? ` · found by ${auditors}` : ""}${bench ? ` · benchmark: ${bench}` : ""}`,
      };
    });
    const html = compose(
      screen,
      r.viewport,
      `file://${beforePng}`,
      `file://${join(afterDir, `${r.name}.png`)}`,
      items,
      sc,
    );
    const tmp = join(afterDir, `annotate-${r.name}.html`);
    writeFileSync(tmp, html);
    await page.goto(`file://${tmp}`);
    await page.waitForLoadState("load");
    const out = join(annotatedDir, `loop-${args.loop}-${r.name}.jpg`);
    await page
      .locator("#sheet")
      .screenshot({ path: out, type: "jpeg", quality: 74 });
    console.log(out);
    written++;
  }
  await browser.close();
  console.log(`${written} annotated images`);
}
gallery();
