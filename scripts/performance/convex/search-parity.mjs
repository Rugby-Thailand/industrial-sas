#!/usr/bin/env node
// Real-engine parity: the candidate's index-backed job-scan search versus the
// base (scan-based) implementation, on identical data. Every needle is paged
// to completion on both targets; ordered result IDs must be identical.
//   node scripts/performance/convex/search-parity.mjs <baseRoot> [needles=300]
import {
  cliData,
  httpClient,
  identity,
  loadDeployment,
  startLogCollector,
} from "./lib.mjs";

const baseRoot = process.argv[2];
const count = Number(process.argv[3] ?? 300);
const clerk = {
  userId: "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
  orgId: "org_3JXrDUraQjTRO3hcIzMGC9CvIXV",
};
const targets = [loadDeployment("."), loadDeployment(baseRoot)].map(
  (deployment) => ({
    deployment,
    http: httpClient(deployment),
    logs: startLogCollector(deployment),
  }),
);
const warehouseId = targets[0].deployment.fixture.warehouseId;

let seed = 7;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const scans = cliData("finishedGoodsJobScans", 8000).filter(
  (scan) => scan.warehouseId === warehouseId,
);
const fields = [
  "factoryOrder",
  "productBarcodeText",
  "partName",
  "customer",
  "locationText",
  "locationCode",
  "locationName",
];
const needles = new Set([
  // Edge cases: separators, case and width folding, spaces, numbers, Thai, buildings, misses.
  "-",
  "()",
  " ",
  "FO",
  "fo6907",
  "ＦＯ６９０７",
  "6907",
  "0120",
  "box-00",
  "BXVMI006 Rev",
  "rev.01",
  "บริษัท",
  "ฟาบริ",
  "จำกัด (สำนัก",
  "ข้างเสา",
  "เสา C1",
  "c12",
  "scale part 1",
  "SCALE-0001",
  "siam pack",
  "annex",
  "demo",
  "zzzz-no-match",
  "ไม่มีข้อมูล",
  "1",
  "9",
  "a",
  "ก",
]);
while (needles.size < count) {
  const scan = scans[Math.floor(random() * scans.length)];
  const value = scan[fields[Math.floor(random() * fields.length)]];
  if (!value) continue;
  const chars = [...value];
  const start = Math.floor(random() * chars.length);
  const length = 1 + Math.floor(random() * Math.min(14, chars.length - start));
  let needle = chars.slice(start, start + length).join("");
  if (random() < 0.2) needle = needle.toUpperCase();
  needles.add(needle);
}

async function allIds(target, filter, search) {
  const ids = [];
  let cursor = null;
  let requests = 0;
  let searchPath = true;
  for (let pageNo = 0; pageNo < 200; pageNo++) {
    let scanCursor;
    let result;
    do {
      target.http.setAdminAuth(target.deployment.adminKey, identity(clerk));
      result = (
        await target.http.query("finishedGoods/jobScans:listJobScans", {
          warehouseId,
          filter,
          search,
          pageSize: 50,
          progressive: true,
          ...(cursor ? { cursor } : {}),
          ...(scanCursor ? { scanCursor } : {}),
        })
      ).value;
      requests++;
      if (result.status === "scanning") searchPath = false;
      scanCursor = result.scanCursor;
    } while (result.status === "scanning");
    if (result.status === "reset")
      throw Error(`reset for ${JSON.stringify(search)}`);
    ids.push(...result.items.map((item) => item.id));
    if (result.isDone || !result.continueCursor)
      return { ids, requests, searchPath };
    cursor = result.continueCursor;
  }
  // A traversal that never finished is a broken comparison, not a match.
  throw Error(`${JSON.stringify(search)} did not finish within 200 pages`);
}

let mismatches = 0;
let searched = 0;
let shortNeedles = 0;
let compared = 0;
// The index serves needles of 3+ code points (MIN_INDEXED_NEEDLE).
const indexable = (needle) => [...needle.normalize("NFKC")].length >= 3;
const cost = { candidate: { requests: 0 }, base: { requests: 0 } };
for (const needle of needles)
  for (const filter of ["ALL", "MAPPED", "UNMAPPED"]) {
    if (filter !== "ALL" && random() < 0.6) continue;
    const [candidate, base] = await Promise.all(
      targets.map((target) => allIds(target, filter, needle)),
    );
    compared++;
    cost.candidate.requests += candidate.requests;
    cost.base.requests += base.requests;
    if (!indexable(needle)) shortNeedles++;
    else if (candidate.searchPath && candidate.ids.length) searched++;
    if (JSON.stringify(candidate.ids) !== JSON.stringify(base.ids)) {
      mismatches++;
      console.log(
        "MISMATCH",
        JSON.stringify(needle),
        filter,
        candidate.ids.length,
        base.ids.length,
      );
    }
  }
for (const target of targets) await target.logs.stop();
console.log(
  JSON.stringify({
    needles: needles.size,
    compared,
    mismatches,
    // Non-empty traversals of indexable needles that never returned
    // `scanning`: answered without the bounded scan. This does not tell an
    // index plan from the exact history fallback, which answers the same way.
    indexableAnsweredWithoutScanning: searched,
    shortNeedleTraversals: shortNeedles,
    requests: cost,
  }),
);
process.exit(mismatches ? 1 : 0);
