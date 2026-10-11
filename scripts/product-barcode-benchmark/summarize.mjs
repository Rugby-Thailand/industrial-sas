import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { format } from "prettier";

const directory = fileURLToPath(
  new URL(
    "../../docs/reviews/assets/product-barcode-non-ai-2026-10-10/",
    import.meta.url,
  ),
);
const manifest = JSON.parse(
  await readFile(join(directory, "manifest.json"), "utf8"),
);
const unique = manifest.filter(
  (row, index) =>
    manifest.findIndex((other) => other.sha256 === row.sha256) === index,
);
const stages = [
  "baseline",
  "bands",
  "js-targeted",
  "wasm-full",
  "wasm-bands",
  "wasm-angles",
  "wasm-fast",
  "wasm-optimized",
];
const rounds = [];
function payloads(row) {
  return [
    ...new Set(
      row.attempts.flatMap((attempt) => [
        ...(attempt.text ? [attempt.text] : []),
        ...(attempt.results || [])
          .filter((result) => result.isValid !== false)
          .map((result) => result.text),
      ]),
    ),
  ];
}
for (const stage of stages) {
  let round;
  try {
    round = JSON.parse(
      await readFile(join(directory, `${stage}.json`), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  const labels =
    stage === "baseline"
      ? ["default-full", "harder-full", "code128-full"]
      : [undefined];
  for (const label of labels) {
    const details = manifest.map((item) => {
      const original = round.results.find((row) => row.name === item.name);
      if (!original || original.sha256 !== item.sha256)
        throw new Error(`Missing or mismatched input: ${stage} ${item.name}`);
      const row = {
        ...original,
        attempts: label
          ? original.attempts.filter((attempt) => attempt.label === label)
          : original.attempts,
      };
      const codes = payloads(row);
      const productCodes =
        stage === "wasm-fast" || stage === "wasm-optimized"
          ? row.codes
          : codes.filter((code) => !/^FO\d{4,}$/i.test(code));
      return {
        name: item.name,
        productRead: productCodes.includes(item.expectedProduct),
        jobRead: codes.includes(item.expectedJob),
        wrongProductCodes: productCodes.filter(
          (code) => code !== item.expectedProduct,
        ),
        reviewRequired: row.reviewRequired || false,
        productCodes,
        decoderMs: row.attempts.reduce((sum, attempt) => sum + attempt.ms, 0),
        totalMs: row.totalMs,
        attempts: row.attempts.length,
        budgetExhausted: row.budgetExhausted || false,
      };
    });
    const distinctDetails = details.filter((row) =>
      unique.some((item) => item.name === row.name),
    );
    rounds.push({
      stage: label || stage,
      decoder: round.decoder,
      productFiles: details.filter((row) => row.productRead).length,
      productUnique: distinctDetails.filter((row) => row.productRead).length,
      jobFiles: details.filter((row) => row.jobRead).length,
      jobUnique: distinctDetails.filter((row) => row.jobRead).length,
      wrongProductFiles: details.filter((row) => row.wrongProductCodes.length)
        .length,
      reviewRequiredFiles: details.filter((row) => row.reviewRequired).length,
      details,
    });
  }
}
const summary = {
  files: manifest.length,
  uniqueImages: unique.length,
  duplicateGroups: unique
    .map((item) =>
      manifest
        .filter((row) => row.sha256 === item.sha256)
        .map((row) => row.name),
    )
    .filter((group) => group.length > 1),
  rounds,
};
await writeFile(
  join(directory, "summary.json"),
  await format(JSON.stringify(summary), { parser: "json" }),
);
console.table(
  rounds.map(
    ({
      stage,
      productFiles,
      productUnique,
      jobFiles,
      wrongProductFiles,
      reviewRequiredFiles,
    }) => ({
      stage,
      productFiles,
      productUnique,
      jobFiles,
      wrongProductFiles,
      reviewRequiredFiles,
    }),
  ),
);

if (process.argv.includes("--verify")) {
  for (const item of manifest) {
    const bytes = await readFile(item.sourcePath);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      item.sha256,
      `${item.name}: original changed`,
    );
  }
  const final = rounds.find((round) => round.stage === "wasm-optimized");
  assert.equal(final?.productFiles, 10);
  assert.equal(final?.productUnique, 7);
  assert.equal(final?.reviewRequiredFiles, 2);
  assert.equal(
    rounds.find((round) => round.stage === "wasm-fast")?.productFiles,
    8,
  );
  for (const round of rounds)
    assert.equal(round.wrongProductFiles, 0, round.stage);
  const controls = JSON.parse(
    await readFile(join(directory, "negative-controls.json"), "utf8"),
  );
  assert.equal(controls.passed, true);
  assert.equal(controls.results.length, 3);
  console.log(
    "Verified: 10 original files / 7 unique images; exact decoded products; 3 negative controls.",
  );
}
