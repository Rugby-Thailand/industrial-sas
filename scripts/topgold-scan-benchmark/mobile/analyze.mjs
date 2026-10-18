// Scores the live-camera replay raw JSONL against the provisional server-side manifest.
// Usage: node scripts/topgold-scan-benchmark/mobile/analyze.mjs [pass] [repeat] [live]
// Writes summary.json and per-call CSV next to the raw files; prints Markdown tables.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dir = resolve(
  process.cwd(),
  "docs/reviews/assets/topgold-scanning-2026-10-16",
);
const raw = resolve(dir, "mobile/raw");
const [passName = "pass", repeatName = "repeat", liveName = "live"] =
  process.argv.slice(2);
const manifest = JSON.parse(
  await readFile(resolve(dir, "manifest.json"), "utf8"),
);
const load = async (name) => {
  try {
    return (await readFile(resolve(raw, `${name}.jsonl`), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

// ---- Provisional truth (never sent to the browser) ---------------------------------
const JOB_LIKE = /^FOM?\d{4,}$/i; // printed header form, FO and FOM
const PROD_JOB = /^FO\d{4,}$/i; // production classifyTicketBarcode
const truth = new Map();
for (const r of manifest.rows) {
  const location = r.category.startsWith("1_");
  truth.set(r.index, {
    location,
    uncertain: location && /ไม่ชัด/.test(r.location),
    locations: location
      ? r.location.split("_และ_").map((s) => s.trim().toUpperCase())
      : [],
    job: location ? null : r.job_no || null,
    fom: !location && /^FOM/i.test(r.job_no || ""),
    negative: !location && !r.job_no,
  });
}
const isQrFormat = (f) => /qr/i.test(f || "");
const isCode128 = (f) => /128/.test(f || "");

const pct = (values, p) => {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return (
    Math.round(
      v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)] * 10,
    ) / 10
  );
};
const median = (v) => pct(v, 50);

// QR payloads are recognised by format where the decoder reports one; the production
// fallback returns text only, so its texts inherit the format other variants saw.
function formatIndex(rows) {
  const map = new Map();
  for (const r of rows)
    for (const s of r.symbols || [])
      if (s.format) map.set(`${r.id}|${s.text}`, s.format);
  return map;
}
const formatOf = (index, row, s) =>
  s.format || index.get(`${row.id}|${s.text}`) || null;

function score(row, index) {
  const t = truth.get(row.id);
  const symbols = (row.symbols || []).map((s) => ({
    ...s,
    format: formatOf(index, row, s),
  }));
  const texts = [...new Set(symbols.map((s) => s.text.trim()))];
  // What the live hook would deliver first: the fallback only delivers a singleton.
  const first =
    row.variant === "liveFallback"
      ? row.accepted
        ? symbols.find((s) => s.text === row.accepted)
        : null
      : symbols[0];
  const out = { distinct: texts.length, read: texts.length > 0 };
  if (!t) return out; // synthetic control
  if (t.location) {
    const upper = texts.map((x) => x.toUpperCase());
    out.locHit = t.locations.some((l) => upper.includes(l));
    out.locAll = t.locations.every((l) => upper.includes(l));
    out.firstWrong =
      !!first && !t.locations.includes(first.text.trim().toUpperCase());
    out.extraIdentity =
      upper.filter((x) => !t.locations.includes(x)).length > 0;
  } else {
    out.jobHit = !!t.job && texts.includes(t.job);
    out.qr = symbols.some((s) => isQrFormat(s.format));
    out.product = symbols.some(
      (s) =>
        !isQrFormat(s.format) &&
        (isCode128(s.format) || !s.format) &&
        !JOB_LIKE.test(s.text) &&
        !/^ISAS:/i.test(s.text),
    );
    out.ticket = out.jobHit && out.product;
    if (first) {
      // The ticket QR carries the JOB number; only a non-JOB QR payload is a wrong kind.
      out.firstQrNonJob =
        isQrFormat(first.format) && !JOB_LIKE.test(first.text);
      out.firstFomAsProduct =
        JOB_LIKE.test(first.text) && !PROD_JOB.test(first.text);
      out.firstOtherFormat =
        !isQrFormat(first.format) && !!first.format && !isCode128(first.format);
    }
  }
  return out;
}

function summarise(rows, index) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.variant}|${r.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const table = [];
  for (const [key, list] of groups) {
    const [variant, size] = key.split("|");
    const scored = list.map((r) => ({
      r,
      s: score(r, index),
      t: truth.get(r.id),
    }));
    const loc = scored.filter((x) => x.t?.location && !x.t.uncertain);
    const tickets = scored.filter((x) => x.t && !x.t.location && x.t.job);
    const fo = tickets.filter((x) => !x.t.fom),
      fom = tickets.filter((x) => x.t.fom);
    const negatives = scored.filter((x) => x.t?.negative);
    const count = (arr, f) => arr.filter(f).length;
    const wall = list.map((r) => r.wallMs);
    const noRead = scored.filter((x) => !x.s.read).map((x) => x.r.wallMs);
    const js = variant.startsWith("js");
    table.push({
      variant,
      size: Number(size),
      n: list.length,
      locN: loc.length,
      locHit: count(loc, (x) => x.s.locHit),
      locFirstWrong: count(loc, (x) => x.s.firstWrong),
      locExtraIdentity: count(loc, (x) => x.s.extraIdentity),
      jobN: tickets.length,
      jobHit: count(tickets, (x) => x.s.jobHit),
      foHit: `${count(fo, (x) => x.s.jobHit)}/${fo.length}`,
      fomHit: `${count(fom, (x) => x.s.jobHit)}/${fom.length}`,
      qrYield: count(tickets, (x) => x.s.qr),
      productYield: count(tickets, (x) => x.s.product),
      ticketBoth: count(tickets, (x) => x.s.ticket),
      firstQrNonJob: count(tickets, (x) => x.s.firstQrNonJob),
      firstFomAsProduct: count(tickets, (x) => x.s.firstFomAsProduct),
      firstOtherFormat: count(tickets, (x) => x.s.firstOtherFormat),
      multiIdentityFrames: count(scored, (x) => x.s.distinct > 1),
      fallbackWithheldMulti:
        variant === "liveFallback"
          ? count(list, (r) => (r.symbols || []).length > 1)
          : null,
      negativeReads: `${count(negatives, (x) => x.s.read)}/${negatives.length}`,
      noRead: noRead.length,
      errors: count(list, (r) => r.error),
      timeouts: count(list, (r) => r.timeout),
      wallP50: median(wall),
      wallP95: pct(wall, 95),
      wallMax: pct(wall, 100),
      noReadP50: median(noRead),
      noReadP95: pct(noRead, 95),
      // Synchronous JS blocks for its whole wall time; otherwise use observed long tasks.
      mainBlockP95: js
        ? pct(wall, 95)
        : pct(
            list.map((r) => r.longTaskMaxMs),
            95,
          ),
      mainBlockMax: js
        ? pct(wall, 100)
        : pct(
            list.map((r) => r.longTaskMaxMs),
            100,
          ),
      longTaskSumP95: pct(
        list.map((r) => r.longTaskSumMs),
        95,
      ),
      grabP50: median(list.map((r) => r.grabMs)),
      postP50: median(list.map((r) => r.postMs)),
      workerPixelsP50: median(list.map((r) => r.pixelsMs)),
      workerDecodeP50: median(list.map((r) => r.decodeMs)),
    });
  }
  const order = [
    "jsDefault",
    "jsHinted",
    "liveFallback",
    "native",
    "wasmRoiFast",
    "wasmRegions",
    "wasmFast",
    "wasmHard",
  ];
  return table.sort(
    (a, b) =>
      b.size - a.size || order.indexOf(a.variant) - order.indexOf(b.variant),
  );
}

/** Overlay ROI vs full-frame fast on identical frames: identities ROI alone would never see. */
function roiLoss(rows) {
  const by = new Map(rows.map((r) => [`${r.variant}|${r.size}|${r.id}`, r]));
  const out = {};
  for (const size of [1920, 1080]) {
    let lostIdentities = 0,
      lostExpected = 0,
      roiOnly = 0,
      frames = 0,
      framesLosing = 0;
    for (const r of rows.filter(
      (x) => x.variant === "wasmFast" && x.size === size,
    )) {
      const roi = by.get(`wasmRoiFast|${size}|${r.id}`);
      if (!roi) continue;
      frames++;
      const full = new Set((r.symbols || []).map((s) => s.text));
      const inRoi = new Set((roi.symbols || []).map((s) => s.text));
      const lost = [...full].filter((x) => !inRoi.has(x));
      lostIdentities += lost.length;
      framesLosing += lost.length ? 1 : 0;
      roiOnly += [...inRoi].filter((x) => !full.has(x)).length;
      const t = truth.get(r.id);
      if (t) {
        const expected = t.location ? t.locations : t.job ? [t.job] : [];
        lostExpected += lost.filter(
          (x) => expected.includes(x.toUpperCase()) || expected.includes(x),
        ).length;
      }
    }
    out[size] = { frames, framesLosing, lostIdentities, lostExpected, roiOnly };
  }
  return out;
}

/**
 * Derived per-frame cascades from measured components on identical frames: run each
 * stage only while the frame is unresolved; cost is the sum of the stages that ran.
 * Resolution uses decoded content only (no labels): a ticket wants a JOB-like and a
 * non-JOB Code128; a location frame wants any symbol.
 */
function cascade(rows, index, stages, name) {
  const by = new Map(rows.map((r) => [`${r.variant}|${r.size}|${r.id}`, r]));
  const out = [];
  for (const size of [1920, 1080]) {
    const list = [];
    for (const head of rows.filter(
      (x) => x.variant === stages[0] && x.size === size,
    )) {
      const t = truth.get(head.id);
      const parts = stages.map((v) => by.get(`${v}|${size}|${head.id}`));
      if (!t || parts.some((p) => !p)) continue;
      const symbols = [];
      let wallMs = 0,
        ran = 0;
      for (const part of parts) {
        ran++;
        wallMs += part.wallMs;
        for (const s of part.symbols || [])
          if (!symbols.some((x) => x.text === s.text)) symbols.push(s);
        const resolved = t.location
          ? symbols.length > 0
          : symbols.some((x) => JOB_LIKE.test(x.text)) &&
            symbols.some((x) => isCode128(x.format) && !JOB_LIKE.test(x.text));
        if (resolved) break;
      }
      list.push({
        ...head,
        variant: name,
        symbols,
        wallMs,
        escalated: ran > 1,
      });
    }
    const [row] = summarise(list, index);
    if (row)
      out.push({ ...row, escalated: list.filter((x) => x.escalated).length });
  }
  return out;
}

function stability(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.variant}|${r.size}|${r.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r.wallMs);
  }
  const per = new Map();
  for (const [key, values] of groups) {
    const [variant, size] = key.split("|");
    const k = `${variant}|${size}`;
    if (!per.has(k))
      per.set(k, { medians: [], spreads: [], reps: values.length });
    const m = median(values);
    per.get(k).medians.push(m);
    per
      .get(k)
      .spreads.push(m ? (Math.max(...values) - Math.min(...values)) / m : 0);
  }
  return [...per].map(([k, v]) => {
    const [variant, size] = k.split("|");
    return {
      variant,
      size: Number(size),
      images: v.medians.length,
      reps: v.reps,
      medianOfMediansMs: median(v.medians),
      p95OfMediansMs: pct(v.medians, 95),
      medianRelSpread: median(v.spreads),
    };
  });
}

function live(rows) {
  const out = {};
  const perImage = [];
  for (const r of rows.filter((x) => x.kind === "live")) {
    const t = truth.get(r.id);
    const ev = r.events || [];
    const expected = t.location ? t.locations : t.job ? [t.job] : [];
    const hit = ev.find((e) =>
      expected.includes(t.location ? e.code.toUpperCase() : e.code),
    );
    const product = !t.location
      ? ev.find(
          (e) =>
            !JOB_LIKE.test(e.code) &&
            !/^ISAS:/i.test(e.code) &&
            !/^https?:/i.test(e.code),
        )
      : null;
    const first = ev[0];
    perImage.push({
      scheduler: r.scheduler,
      id: r.id,
      target: r.target,
      scored: !(t.location && t.uncertain) && expected.length > 0,
      hitMs: hit?.atMs ?? null,
      hitVia: hit?.via ?? null,
      productMs: product?.atMs ?? null,
      firstCode: first?.code ?? null,
      // Wrong first delivery is scored for locations only; a ticket's product is valid.
      firstWrong:
        t.location && !!first && !expected.includes(first.code.toUpperCase()),
      firstFomAsProduct:
        !!first && JOB_LIKE.test(first.code) && !PROD_JOB.test(first.code),
      distinct: new Set(ev.map((e) => e.code)).size,
      wrongLocationCodes: t.location
        ? ev
            .filter(
              (e) => !t.uncertain && !expected.includes(e.code.toUpperCase()),
            )
            .map((e) => `${e.code}@${e.via}`)
        : [],
      attempts:
        r.attempts ?? Object.values(r.grabs || {}).reduce((a, b) => a + b, 0),
      grabs: r.grabs,
      fallbacks: r.fallbacks?.length ?? 0,
      fallbackMs: (r.fallbacks || []).reduce((a, f) => a + f.ms, 0),
      fallbackMaxMs: Math.max(0, ...(r.fallbacks || []).map((f) => f.ms)),
      rafMaxGapMs: r.rafMaxGapMs,
      rafFrames: r.rafFrames,
      longTaskMaxMs: r.longTaskMaxMs,
      longTaskSumMs: r.longTaskSumMs,
      windowMs: r.windowMs,
      readyMs: r.readyMs,
      stopMs: r.stopMs,
      lateCallbacks: r.lateCallbacks,
      negative: t.negative,
    });
  }
  for (const scheduler of [
    "current",
    "current-run2",
    "proposed",
    "proposed-run2",
    "proposedV2",
  ]) {
    const list = perImage.filter((x) => x.scheduler === scheduler);
    if (!list.length) continue;
    const scored = list.filter((x) => x.scored);
    const loc = scored.filter((x) => x.target === "LOCATION"),
      tk = scored.filter((x) => x.target === "TICKET");
    const hits = scored.filter((x) => x.hitMs !== null).map((x) => x.hitMs);
    out[scheduler] = {
      images: list.length,
      locHit: `${loc.filter((x) => x.hitMs !== null).length}/${loc.length}`,
      jobHit: `${tk.filter((x) => x.hitMs !== null).length}/${tk.length}`,
      ticketProductCandidate: `${tk.filter((x) => x.productMs !== null).length}/${tk.length}`,
      hitMsP50: median(hits),
      hitMsP95: pct(hits, 95),
      firstWrong: list.filter((x) => x.firstWrong && !x.negative).length,
      locationImagesWithWrongDelivery: list
        .filter((x) => x.wrongLocationCodes.length)
        .map((x) => `${x.id}:${x.wrongLocationCodes.join("|")}`),
      firstFomAsProduct: list.filter((x) => x.firstFomAsProduct).length,
      negativeDelivered: list.filter((x) => x.negative && x.firstCode).length,
      attemptsP50: median(list.map((x) => x.attempts)),
      fallbacksP50: median(list.map((x) => x.fallbacks)),
      fallbackMaxMs: pct(
        list.map((x) => x.fallbackMaxMs),
        100,
      ),
      rafMaxGapP50: median(list.map((x) => x.rafMaxGapMs)),
      rafMaxGapP95: pct(
        list.map((x) => x.rafMaxGapMs),
        95,
      ),
      rafMaxGapMax: pct(
        list.map((x) => x.rafMaxGapMs),
        100,
      ),
      longTaskMaxP95: pct(
        list.map((x) => x.longTaskMaxMs),
        95,
      ),
      longTaskSumP50: median(list.map((x) => x.longTaskSumMs)),
      stopMsMax: pct(
        list.map((x) => x.stopMs),
        100,
      ),
      // Results that arrived after stop and were dropped (never delivered).
      droppedAfterStop: list.reduce((a, x) => a + (x.lateCallbacks || 0), 0),
      hitVia: list.reduce((a, x) => {
        if (x.hitVia) a[x.hitVia] = (a[x.hitVia] || 0) + 1;
        return a;
      }, {}),
    };
  }
  return { summary: out, perImage };
}

const md = (rows, cols) => {
  if (!rows.length) return "(no rows)\n";
  const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n`;
  return (
    head +
    rows
      .map((r) => `| ${cols.map((c) => r[c] ?? "").join(" | ")} |`)
      .join("\n") +
    "\n"
  );
};

// Post-hoc runs (wasmRegions, proposedV2) are stored under "<name>-regions" / "live2".
const passAll = [
  ...(await load(passName)),
  ...(await load(`${passName}-regions`)),
];
const passRows = passAll.filter((r) => r.kind === "result");
const controlRows = passAll.filter((r) => r.kind === "control");
const repeatRows = (await load(repeatName)).filter((r) => r.kind === "result");
const repeatRegionRows = (await load(`${repeatName}-regions`)).filter(
  (r) => r.kind === "result",
);
const liveRows = [
  ...(await load(liveName)),
  // Same schedulers re-run end to end, for run-to-run stability.
  ...(await load(`${liveName}-rerun`)).map((r) =>
    r.kind === "live" ? { ...r, scheduler: `${r.scheduler}-run2` } : r,
  ),
  ...(await load(`${liveName}2`)),
];
const index = formatIndex([...passRows, ...repeatRows]);
const setup = [
  ...(await load(passName)),
  ...(await load(repeatName)),
  ...liveRows,
].filter((r) => r.kind === "setup");
const meta = [
  ...(await load(passName)),
  ...(await load(repeatName)),
  ...liveRows,
].filter((r) => r.kind === "meta");

const qrPayloads = [
  ...new Set(
    passRows.flatMap((r) =>
      (r.symbols || []).filter((s) => isQrFormat(s.format)).map((s) => s.text),
    ),
  ),
];
const formats = {};
for (const r of passRows)
  for (const s of r.symbols || [])
    if (s.format)
      formats[`${r.variant}:${s.format}`] =
        (formats[`${r.variant}:${s.format}`] || 0) + 1;

const summary = {
  meta,
  setup,
  pass: summarise(passRows, index),
  cascade: [
    ...cascade(passRows, index, ["wasmFast", "wasmHard"], "fast>hard"),
    ...cascade(
      passRows,
      index,
      ["wasmFast", "wasmRegions", "wasmHard"],
      "fast>regions>hard",
    ),
    ...cascade(passRows, index, ["native", "wasmRegions"], "native>regions"),
  ],
  roiLoss: roiLoss(passRows),
  controls: controlRows.map((r) => ({
    variant: r.variant,
    id: r.id,
    symbols: (r.symbols || []).map((s) => s.text),
    wallMs: Math.round(r.wallMs),
  })),
  repeat: summarise(repeatRows, index),
  stability: stability(repeatRows),
  repeatRegions: summarise(repeatRegionRows, index),
  stabilityRegions: stability(repeatRegionRows),
  diagnose: (await load("diagnose")).filter((r) => r.kind === "diagnose"),
  live: live(liveRows),
  formatsSeen: formats,
  qrPayloadSamples: qrPayloads.slice(0, 5).map((t) => t.slice(0, 80)),
  qrPayloadCount: qrPayloads.length,
};
await writeFile(
  resolve(raw, "../summary.json"),
  JSON.stringify(summary, null, 2),
);
const csv = ["phase,id,target,size,variant,rep,wallMs,longTaskMaxMs,symbols"];
for (const r of [...passRows, ...repeatRows])
  csv.push(
    [
      r.phase,
      r.id,
      r.target,
      r.size,
      r.variant,
      r.rep,
      Math.round(r.wallMs * 10) / 10,
      Math.round(r.longTaskMaxMs || 0),
      JSON.stringify((r.symbols || []).map((s) => s.text).join(" ; ")),
    ].join(","),
  );
await writeFile(resolve(raw, "../calls.csv"), csv.join("\n") + "\n");

const recallCols = [
  "variant",
  "size",
  "n",
  "locHit",
  "locN",
  "locFirstWrong",
  "locExtraIdentity",
  "jobHit",
  "jobN",
  "foHit",
  "fomHit",
  "qrYield",
  "productYield",
  "ticketBoth",
  "firstQrNonJob",
  "firstFomAsProduct",
  "firstOtherFormat",
  "multiIdentityFrames",
  "negativeReads",
  "errors",
  "timeouts",
];
const timeCols = [
  "variant",
  "size",
  "wallP50",
  "wallP95",
  "wallMax",
  "noRead",
  "noReadP50",
  "noReadP95",
  "mainBlockP95",
  "mainBlockMax",
  "grabP50",
  "postP50",
  "workerPixelsP50",
  "workerDecodeP50",
];
console.log("## Pass recall\n" + md(summary.pass, recallCols));
console.log("## Pass timing\n" + md(summary.pass, timeCols));
console.log(
  "## Derived cascade\n" +
    md(summary.cascade, [
      ...recallCols.slice(0, 13),
      "wallP50",
      "wallP95",
      "escalated",
    ]),
);
console.log("## ROI loss\n" + JSON.stringify(summary.roiLoss));
console.log("## Controls\n" + JSON.stringify(summary.controls));
console.log("## Repeat timing\n" + md(summary.repeat, timeCols));
console.log("## Repeat (regions run)\n" + md(summary.repeatRegions, timeCols));
console.log(
  "## Stability (regions run)\n" +
    md(summary.stabilityRegions, [
      "variant",
      "size",
      "images",
      "reps",
      "medianOfMediansMs",
      "p95OfMediansMs",
      "medianRelSpread",
    ]),
);
console.log(
  "## Diagnose\n" +
    JSON.stringify(summary.diagnose.map((d) => [d.id, d.size, d.decodes])),
);
console.log(
  "## Stability\n" +
    md(summary.stability, [
      "variant",
      "size",
      "images",
      "reps",
      "medianOfMediansMs",
      "p95OfMediansMs",
      "medianRelSpread",
    ]),
);
console.log("## Live\n" + JSON.stringify(summary.live.summary, null, 2));
console.log(
  "## Formats\n" +
    JSON.stringify(formats) +
    "\nQR payloads: " +
    summary.qrPayloadCount +
    " " +
    JSON.stringify(summary.qrPayloadSamples),
);
