import test from "node:test";
import assert from "node:assert/strict";
import {
  candidates,
  fieldOf,
  targetFound,
  scoreTrial,
  summarise,
  csvCell,
} from "./device-model.mjs";

const job = { text: "FOM69100125", format: "QRCode" };
const product = { text: "AA-123", format: "Code128" };
const base = {
  method: "wasm",
  source: "camera",
  target: "both",
  maxSide: 1920,
  reason: "timeout",
  expected: { job: "FOM69100125", product: "AA-123" },
  symbols: [job, product],
  firstCompleteMs: 200,
  attemptWallMs: [20, 40],
};

test("FO and FOM are JOB candidates; arbitrary QR text cannot become a product", () => {
  assert.equal(fieldOf(job), "job");
  assert.equal(fieldOf({ text: "FO123456", format: "CODE_128" }), "job");
  assert.equal(
    fieldOf({ text: "https://example.com", format: "qr_code" }),
    "other",
  );
  assert.equal(fieldOf({ text: "AA-123", format: null }), "other");
});
test("same text from QR and Code128 deduplicates only the field, preserving ambiguity between values", () => {
  assert.deepEqual(candidates([job, { ...job, format: "Code128" }]).job, [
    job.text,
  ]);
  assert.equal(targetFound("both", [job]), false);
  assert.equal(targetFound("both", [job, product]), true);
  const ambiguous = scoreTrial({
    ...base,
    symbols: [job, product, { ...product, text: "AA-999" }],
  });
  assert.equal(ambiguous.exact, false);
  assert.equal(ambiguous.scores.product, "ambiguous");
});
test("no-read and wrong candidates stay in accuracy denominator; expected answers never change acquisition", () => {
  const rows = [
    base,
    { ...base, symbols: [], firstCompleteMs: null, attemptWallMs: [90] },
    {
      ...base,
      symbols: [job, { ...product, text: "wrong" }],
      firstCompleteMs: 50,
    },
  ];
  const [group] = summarise(rows);
  assert.equal(group.scored, 3);
  assert.equal(group.correct, 1);
  assert.equal(group.noRead, 1);
  assert.equal(group.incorrect, 1);
  assert.equal(group.correctTimeP50, 200);
  assert.equal(group.attemptP95, 90);
});
test("unlabelled and interrupted trials do not masquerade as measured accuracy", () => {
  const [group] = summarise([
    { ...base, expected: {} },
    { ...base, reason: "hidden" },
    { ...base, reason: "error" },
  ]);
  assert.equal(group.total, 3);
  assert.equal(group.completed, 1);
  assert.equal(group.scored, 0);
  assert.equal(group.interrupted, 2);
  assert.equal(group.correctTimeP95, null);
});
test("sources, targets and frame sizes are separated and JOB comparison alone is case-insensitive", () => {
  assert.equal(
    summarise([
      base,
      { ...base, source: "photo" },
      { ...base, target: "job" },
      { ...base, maxSide: 1080 },
    ]).length,
    4,
  );
  assert.equal(
    scoreTrial({ ...base, expected: { job: "fom69100125", product: "aa-123" } })
      .scores.job,
    "correct",
  );
  assert.equal(
    scoreTrial({ ...base, expected: { job: "fom69100125", product: "aa-123" } })
      .scores.product,
    "incorrect",
  );
});
test("CSV quotes text and neutralises spreadsheet formulas", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("=1+1"), '"\'=1+1"');
});
