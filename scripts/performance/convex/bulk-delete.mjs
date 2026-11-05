// Local-only accepted-limit probe. Setup creates300 diverse scans; reports deletion and optional transaction metrics.
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  loadDeployment,
  httpClient,
  identity,
  startLogCollector,
  cliData,
} from "./lib.mjs";
const label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label)) throw Error("safe label required");
const deployment = loadDeployment();
const client = httpClient(deployment);
client.setAdminAuth(
  deployment.adminKey,
  identity({
    userId:
      process.env.LOCAL_TEST_CLERK_USER_ID ??
      "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
    orgId:
      process.env.LOCAL_TEST_CLERK_ORG_ID ?? "org_3JXrDUraQjTRO3hcIzMGC9CvIXV",
  }),
);
const warehouseId = deployment.fixture.warehouseId;
let ids;
let prefix;
if (process.argv[3])
  ({ ids, prefix } = JSON.parse(readFileSync(process.argv[3], "utf8")));
else {
  prefix = `LIMIT-${randomUUID().slice(0, 8)}`;
  for (let offset = 0; offset < 300; offset += 10) {
    const items = Array.from({ length: 10 }, (_, j) => {
      const i = offset + j;
      const unique = randomUUID().slice(0, 12);
      return {
        factoryOrder: `FO69${String(950000 + i)}`,
        productBarcodeText: `${prefix}-${i}-${unique}`,
        partName: `PART ${i} ${unique}`,
        customer: `CUSTOMER ${i} ${unique}`,
        quantity: 100,
        source: "MANUAL",
      };
    });
    const saved = await client.mutation("finishedGoods/jobScans:saveJobScans", {
      warehouseId,
      requestId: `${prefix}-save-${offset}`,
      locationText: prefix,
      items,
    });
    if (!saved.ok || !saved.value?.written)
      throw Error(`Save refused: ${JSON.stringify(saved)}`);
  }
  ids = cliData("finishedGoodsJobScans", 8000)
    .filter(
      (row) =>
        row.warehouseId === warehouseId &&
        row.productBarcodeText?.startsWith(prefix),
    )
    .map((row) => row._id);
  if (ids.length !== 300) throw Error(`Expected300, got${ids.length}`);
  writeFileSync(
    `output/perf/${label}-ids.json`,
    JSON.stringify({ prefix, ids }),
  );
}
const fn =
  process.env.PERF_METRICS === "1"
    ? "staging/performanceLimits:deleteScans"
    : "finishedGoods/jobScans:deleteJobScans";
const logs = startLogCollector(deployment);
try {
  const started = Date.now();
  const t0 = performance.now();
  let result, error;
  try {
    result = await client.function(fn, undefined, {
      warehouseId,
      requestId: `${prefix}-${label}`,
      ids,
    });
  } catch (e) {
    error = String(e.message);
  }
  const rttMs = performance.now() - t0;
  await logs.settle(Date.now());
  const executions = logs.entries
    .filter(
      (e) =>
        e.identifier === fn &&
        e.caller === "HttpApi" &&
        e.executionTimestamp * 1000 >= started,
    )
    .map(({ usageStats, executionTime, error }) => ({
      usageStats,
      executionTime,
      error,
    }));
  const remaining = cliData("finishedGoodsJobScans", 8000).filter((row) =>
    ids.includes(row._id),
  ).length;
  const report = {
    label,
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      cwd: process.env.PERF_SOURCE_ROOT ?? process.cwd(),
    }).trim(),
    sourceRoot: process.env.PERF_SOURCE_ROOT ?? process.cwd(),
    fn,
    selected: ids.length,
    remaining,
    result,
    error,
    rttMs,
    executions,
    scope:
      "Real local engine; one300-record high-diversity public delete; setup excluded; deferred work excluded",
  };
  writeFileSync(
    `output/perf/${label}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await logs.stop();
}
