// Scores raw Kiro benchmark rows against the provisional manifest (server-side
// labels) and the manual printed-product subset. Run with Node 24:
//   node scripts/topgold-scan-benchmark/kiro/analyze.mjs pass1 [more runs...]
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dir = resolve(
  process.cwd(),
  "docs/reviews/assets/topgold-scanning-2026-10-16",
);
const out = resolve(dir, "kiro");
const manifest = JSON.parse(
  await readFile(resolve(dir, "manifest.json"), "utf8"),
);
const manual = new Map(
  JSON.parse(
    await readFile(resolve(out, "manual-products.json"), "utf8"),
  ).rows.map((r) => [r.id, r]),
);
const meta = new Map(manifest.rows.map((r) => [r.index, r]));
const probe = new Map();
try {
  for (const line of (
    await readFile(resolve(out, "raw", "probe.jsonl"), "utf8")
  )
    .trim()
    .split("\n")) {
    const row = JSON.parse(line);
    if (row.kind === "probe") probe.set(row.id, row);
  }
} catch {
  // Probe run is optional.
}
const JOB_FOM = /^FOM?\d{4,}$/i; // printed ticket header format (FO… and FOM…)
const JOB_PROD = /^FO\d{4,}$/i; // production classifyTicketBarcode()

export function expected(id) {
  const row = meta.get(id);
  if (row.category.startsWith("1_")) {
    if (row.location.includes("เลขท้ายไม่ชัด"))
      return {
        kind: "LOCATION",
        uncertainPrefix: row.location.split("_")[0] + "-",
      };
    return { kind: "LOCATION", locations: row.location.split("_และ_") };
  }
  return { kind: "TICKET", job: row.job_no || null, manual: manual.get(id) };
}

function codesOf(row) {
  if (row.production)
    return row.production.codes.map((text) => ({
      text,
      format: null,
      review: !!row.production.reviewRequired,
    }));
  // Pass-1 rows kept only the first format per payload; later rows list every format.
  return (row.symbols || []).map((s) => ({
    text: s.text,
    format: s.format,
    formats: s.formats ?? [s.format],
    review: s.review,
  }));
}

export function score(row) {
  const exp = expected(row.id);
  const codes = codesOf(row);
  const strict = codes.filter((c) => !c.review);
  const review = codes.filter((c) => c.review);
  const base = {
    codes: codes
      .map(
        (c) =>
          `${c.text}${c.format ? `[${c.format}]` : ""}${c.review ? "{review}" : ""}`,
      )
      .join(" | "),
  };
  // Errors and timeouts stay in every denominator (e.g. production 16 MP rejects).
  const scoreable = exp.kind === "LOCATION" ? !exp.uncertainPrefix : true;
  if (row.timeout)
    return { ...base, status: "timeout", jobStatus: "timeout", scoreable };
  if (row.error)
    return {
      ...base,
      status: "error",
      jobStatus: "error",
      error: row.error,
      scoreable,
    };
  if (exp.kind === "LOCATION") {
    const got = new Set(strict.map((c) => c.text));
    if (exp.uncertainPrefix) {
      const consistent = [...got].filter((t) =>
        t.startsWith(exp.uncertainPrefix),
      );
      return {
        ...base,
        status: got.size
          ? consistent.length === got.size
            ? "prefix-consistent"
            : "wrong"
          : review.length
            ? "review-only"
            : "no-read",
        scoreable: false,
      };
    }
    const want = new Set(exp.locations);
    const wrong = [...got].filter((t) => !want.has(t));
    const right = [...got].filter((t) => want.has(t));
    let status;
    if (wrong.length) status = right.length ? "wrong+correct" : "wrong";
    else if (right.length === want.size) status = "exact";
    else if (right.length) status = "partial";
    else status = review.length ? "review-only" : "no-read";
    return {
      ...base,
      status,
      scoreable: true,
      multi: want.size > 1,
      wrongCodes: wrong.join(" "),
    };
  }
  const jobs = new Set(
    strict.filter((c) => JOB_FOM.test(c.text)).map((c) => c.text),
  );
  const reviewJobs = review.filter((c) => JOB_FOM.test(c.text));
  let jobStatus;
  if (!exp.job) jobStatus = jobs.size ? "false-job" : "no-job-correct";
  else if (jobs.size === 1 && jobs.has(exp.job)) jobStatus = "exact";
  else if (jobs.has(exp.job)) jobStatus = "multiple";
  else if (jobs.size) jobStatus = "wrong";
  else jobStatus = reviewJobs.length ? "review-only" : "no-read";
  // Production field assignment: classifyTicketBarcode sends FOM… to the product field.
  const prodJobs = new Set(
    strict.filter((c) => JOB_PROD.test(c.text)).map((c) => c.text),
  );
  const prodProducts = new Set(
    strict
      .filter(
        (c) =>
          !JOB_PROD.test(c.text) &&
          !/^ISAS:/i.test(c.text) &&
          c.format !== "QRCode",
      )
      .map((c) => c.text),
  );
  const products = new Set(
    strict
      .filter(
        (c) =>
          !JOB_FOM.test(c.text) &&
          !/^ISAS:/i.test(c.text) &&
          c.format !== "QRCode",
      )
      .map((c) => c.text),
  );
  const reviewProducts = review.filter(
    (c) => !JOB_FOM.test(c.text) && c.format !== "QRCode",
  );
  const qr = codes.filter((c) => (c.formats ?? [c.format]).includes("QRCode"));
  let manualStatus = "";
  if (exp.manual?.printed) {
    if (products.size === 1 && products.has(exp.manual.printed))
      manualStatus = "match";
    else if (products.has(exp.manual.printed)) manualStatus = "match+other";
    else if (products.size) manualStatus = "mismatch";
    else
      manualStatus = reviewProducts.some((c) => c.text === exp.manual.printed)
        ? "review-only-match"
        : "no-read";
  } else if (exp.manual)
    manualStatus = products.size
      ? "decoded-illegible-print"
      : "no-read-illegible-print";
  const fieldOk =
    exp.job &&
    prodJobs.size === 1 &&
    prodJobs.has(exp.job) &&
    prodProducts.size === 1;
  return {
    ...base,
    status: jobStatus,
    jobStatus,
    productCount: products.size,
    productReviewOnly: !products.size && reviewProducts.length > 0,
    fullTicket: jobStatus === "exact" && products.size === 1,
    productionFieldOk: !!fieldOk,
    fom: !!exp.job && exp.job.startsWith("FOM"),
    qrCount: qr.length,
    qrIsJob: qr.some((c) => c.text === exp.job),
    manualStatus,
    products: [...products].join(" "),
  };
}

const pct = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
};
const r0 = (v) => (v == null ? "" : Math.round(v));

export async function load(run) {
  const text = await readFile(resolve(out, "raw", `${run}.jsonl`), "utf8");
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

function summarise(rows) {
  const by = new Map();
  for (const row of rows) {
    const key = row.variant;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(row);
  }
  const summary = {};
  for (const [variant, list] of by) {
    const loc = list.filter((r) => r.target === "LOCATION");
    const tix = list.filter((r) => r.target === "TICKET");
    const count = (l, f) => l.filter(f).length;
    const scoreLoc = loc.filter((r) => r.score.scoreable);
    const withJob = tix.filter((r) => expected(r.id).job);
    const manualRows = tix.filter((r) => expected(r.id).manual?.printed);
    const timing = (l) => {
      // Timeouts remain in the latency denominator at their capped wall time.
      const wall = l.map((r) => r.wallMs);
      return {
        n: l.length,
        p50: r0(pct(wall, 50)),
        p95: r0(pct(wall, 95)),
        max: r0(Math.max(...l.map((r) => r.wallMs))),
        mean: r0(wall.reduce((a, b) => a + b, 0) / (wall.length || 1)),
      };
    };
    summary[variant] = {
      images: list.length,
      timeouts: count(list, (r) => r.timeout),
      errors: count(list, (r) => r.error),
      errorCodes: [
        ...new Set(
          list.filter((r) => r.error).map((r) => String(r.error).slice(0, 40)),
        ),
      ],
      location: {
        scoreable: scoreLoc.length,
        exact: count(scoreLoc, (r) => r.score.status === "exact"),
        partial: count(scoreLoc, (r) => r.score.status === "partial"),
        wrong: count(scoreLoc, (r) => r.score.status.startsWith("wrong")),
        reviewOnly: count(scoreLoc, (r) => r.score.status === "review-only"),
        noRead: count(scoreLoc, (r) => r.score.status === "no-read"),
        multiExact: count(
          scoreLoc,
          (r) => r.score.multi && r.score.status === "exact",
        ),
        uncertain17: loc.find((r) => !r.score.scoreable)?.score.status,
        wrongCodes: scoreLoc
          .filter((r) => r.score.wrongCodes)
          .map((r) => `${r.id}:${r.score.wrongCodes}`),
      },
      ticket: {
        withJob: withJob.length,
        jobExact: count(withJob, (r) => r.score.jobStatus === "exact"),
        jobExactFom: count(
          withJob,
          (r) => r.score.fom && r.score.jobStatus === "exact",
        ),
        fomTotal: count(withJob, (r) => r.score.fom),
        jobMultiple: count(withJob, (r) => r.score.jobStatus === "multiple"),
        jobWrong: count(withJob, (r) => r.score.jobStatus === "wrong"),
        jobReviewOnly: count(
          withJob,
          (r) => r.score.jobStatus === "review-only",
        ),
        jobNoRead: count(withJob, (r) => r.score.jobStatus === "no-read"),
        productYield: count(withJob, (r) => r.score.productCount >= 1),
        productAmbiguous: count(withJob, (r) => r.score.productCount > 1),
        productReviewOnly: count(withJob, (r) => r.score.productReviewOnly),
        fullTicket: count(withJob, (r) => r.score.fullTicket),
        productionFieldOk: count(withJob, (r) => r.score.productionFieldOk),
        qrDecoded: count(withJob, (r) => r.score.qrCount > 0),
        qrIsJob: count(withJob, (r) => r.score.qrIsJob),
        noJobLabels: tix
          .filter((r) => !expected(r.id).job)
          .map(
            (r) => `${r.id}:${r.score.jobStatus}:${r.score.products || "-"}`,
          ),
        manual: {
          legible: manualRows.length,
          match: count(manualRows, (r) => r.score.manualStatus === "match"),
          matchPlusOther: count(
            manualRows,
            (r) => r.score.manualStatus === "match+other",
          ),
          mismatch: count(
            manualRows,
            (r) => r.score.manualStatus === "mismatch",
          ),
          noRead: count(manualRows, (r) =>
            ["no-read", "review-only-match"].includes(r.score.manualStatus),
          ),
          mismatches: manualRows
            .filter((r) => r.score.manualStatus === "mismatch")
            .map((r) => `${r.id}:${r.score.products}`),
        },
      },
      timing: { all: timing(list), location: timing(loc), ticket: timing(tix) },
      decodeMsP50: r0(
        pct(
          list.filter((r) => r.decodeMs != null).map((r) => r.decodeMs),
          50,
        ),
      ),
      bitmapMsP50: r0(
        pct(
          list.filter((r) => r.bitmapMs != null).map((r) => r.bitmapMs),
          50,
        ),
      ),
    };
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const run of process.argv.slice(2)) {
    const rows = (await load(run))
      .filter((r) => r.kind === "result")
      .map((r) => ({ ...r, score: score(r) }));
    const header = [
      "run",
      "order",
      "round",
      "variant",
      "id",
      "target",
      "sha256",
      "width",
      "height",
      "bytes",
      "wallMs",
      "decodeMs",
      "bitmapMs",
      "attempts",
      "regions",
      "timeout",
      "error",
      "status",
      "productCount",
      "fullTicket",
      "productionFieldOk",
      "manualStatus",
      "qrCount",
      "codes",
    ];
    const csv = [header.join(",")];
    for (const r of rows) {
      const v = {
        run,
        ...r,
        sha256: meta.get(r.id).sha256,
        width: r.width ?? probe.get(r.id)?.width ?? "",
        height: r.height ?? probe.get(r.id)?.height ?? "",
        wallMs: r0(r.wallMs),
        decodeMs: r0(r.decodeMs),
        bitmapMs: r0(r.bitmapMs),
        attempts: r.attempts ?? r.production?.attempts ?? "",
        ...r.score,
        error: r.error ?? "",
      };
      csv.push(header.map((h) => JSON.stringify(v[h] ?? "")).join(","));
    }
    await writeFile(
      resolve(out, `per-image-${run}.csv`),
      csv.join("\n") + "\n",
    );
    // Production rejects >16 MP; prodWarm bypasses that guard. Also report the 133 eligible images.
    const eligible = (r) => {
      const p = probe.get(r.id);
      return !p || p.width * p.height <= 16_000_000;
    };
    const summary = {
      all: summarise(rows),
      eligibleUnder16MP: summarise(rows.filter(eligible)),
    };
    if (rows.some((r) => r.round > 0)) {
      // Repeated timing: per-round wall p50/p95 and per-image spread across rounds.
      summary.rounds = {};
      for (const variant of new Set(rows.map((r) => r.variant))) {
        const list = rows.filter((r) => r.variant === variant);
        const perRound = [...new Set(list.map((r) => r.round))].map((round) => {
          const wall = list
            .filter((r) => r.round === round)
            .map((r) => r.wallMs);
          return {
            round,
            p50: r0(pct(wall, 50)),
            p95: r0(pct(wall, 95)),
            mean: r0(wall.reduce((a, b) => a + b, 0) / wall.length),
          };
        });
        const spreads = [...new Set(list.map((r) => r.id))].map((id) => {
          const wall = list.filter((r) => r.id === id).map((r) => r.wallMs);
          return (Math.max(...wall) - Math.min(...wall)) / (pct(wall, 50) || 1);
        });
        const stable = [...new Set(list.map((r) => r.id))].every(
          (id) =>
            new Set(list.filter((r) => r.id === id).map((r) => r.score.codes))
              .size === 1,
        );
        summary.rounds[variant] = {
          perRound,
          medianRelativeSpread: Math.round(pct(spreads, 50) * 100) / 100,
          maxRelativeSpread: Math.round(Math.max(...spreads) * 100) / 100,
          identicalOutputsAcrossRounds: stable,
        };
      }
    }
    await writeFile(
      resolve(out, `summary-${run}.json`),
      JSON.stringify(summary, null, 2) + "\n",
    );
    console.log(JSON.stringify(summary, null, 1));
  }
}
