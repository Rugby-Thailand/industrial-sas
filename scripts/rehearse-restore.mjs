#!/usr/bin/env node
/**
 * The restore rehearsal (`ADR-0021`, plan §10 Phase 4, `RG-006`).
 *
 * A backup nobody has restored is a hypothesis. This script turns it into a
 * measurement that runs on a laptop with no cloud account: build a dataset, seal
 * it, open it, and prove the result is byte-identical to what went in — then
 * prove the three ways it can fail actually fail.
 *
 * It rehearses the *format and the procedure*, which is the half that can be
 * verified locally. What it deliberately does not claim is a production restore:
 * that needs a real Convex snapshot, a real key from the operator's key store,
 * and a stopwatch against the agreed RTO. `docs/runbooks/backup-and-restore.md`
 * carries that procedure and names it as an open gate.
 *
 * Exits non-zero on any mismatch, so it can be a CI step rather than a ritual.
 */
import { randomBytes } from "node:crypto";

import { KEY_BYTES, openExport, sealExport } from "./lib/exportEnvelope.mjs";

/** Rows shaped like the tenant data an export actually carries. */
function syntheticRecords(count) {
  return Array.from({ length: count }, (_, index) => ({
    table: "inventoryBalances",
    bucketKey: `bucket_${index}`,
    itemId: `prv_item_${index % 7}`,
    // Thai, because a UTF-8 round trip that only ever saw ASCII proves nothing
    // about the language this product is written for first.
    itemName: "เหล็กม้วนรีดร้อน",
    stockStatus: index % 3 === 0 ? "QC_HOLD" : "AVAILABLE",
    quantity: { uom: "KG", minorUnits: index * 1_000 },
  }));
}

const report = [];
const check = (name, condition) => {
  report.push({ name, passed: condition });
  return condition;
};

function main() {
  const key = randomBytes(KEY_BYTES);
  const records = syntheticRecords(500);

  const sealedAt = performance.now();
  const envelope = sealExport({
    records,
    key,
    createdAt: "1970-01-01T00:00:00.000Z",
    tenant: "org_rehearsal",
  });
  const sealMs = performance.now() - sealedAt;

  const openedAt = performance.now();
  const restored = openExport(envelope, key);
  const openMs = performance.now() - openedAt;

  check("restores every record", restored.length === records.length);
  check(
    "restores every record unchanged, Thai included",
    JSON.stringify(restored) === JSON.stringify(records),
  );

  // The archive must be unreadable without the key it was sealed with.
  check(
    "refuses a wrong key",
    (() => {
      try {
        openExport(envelope, randomBytes(KEY_BYTES));
        return false;
      } catch (error) {
        return error.message === "AUTHENTICATION_FAILED";
      }
    })(),
  );

  // A modified ciphertext must not decrypt to anything at all.
  check(
    "refuses a tampered archive",
    (() => {
      const bytes = Buffer.from(envelope.ciphertext, "base64");
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      try {
        openExport({ ...envelope, ciphertext: bytes.toString("base64") }, key);
        return false;
      } catch (error) {
        return error.message === "AUTHENTICATION_FAILED";
      }
    })(),
  );

  // And the case a backup story usually misses: it restores, but short.
  check(
    "refuses an archive that is short",
    (() => {
      const truncated = sealExport({
        records: records.slice(0, 400),
        key,
        createdAt: envelope.createdAt,
        tenant: envelope.tenant,
      });
      try {
        openExport({ ...truncated, recordCount: 500 }, key);
        return false;
      } catch (error) {
        return error.message === "RECORD_COUNT_MISMATCH";
      }
    })(),
  );

  for (const entry of report) {
    console.log(`${entry.passed ? "ok  " : "FAIL"}  ${entry.name}`);
  }
  console.log(
    `\n${records.length} records · seal ${sealMs.toFixed(1)}ms · restore ${openMs.toFixed(1)}ms`,
  );
  console.log(
    "\nRehearsed locally: envelope format, encryption, and the three refusals.",
  );
  console.log(
    "Still open: a production snapshot restored against the agreed RTO with a",
  );
  console.log(
    "key from the operator's key store — see docs/runbooks/backup-and-restore.md.",
  );

  return report.every((entry) => entry.passed) ? 0 : 1;
}

process.exitCode = main();
