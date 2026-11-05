// One maintained building create followed by real-engine reconciliation.
// Local development fixture only; leaves the new draft building in that fixture.
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  loadDeployment,
  httpClient,
  identity,
  startLogCollector,
  cliData,
} from "./lib.mjs";
const label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label))
  throw Error("Provide a safe report label");
const deployment = loadDeployment();
const client = httpClient(deployment);
const warehouseId = deployment.fixture.warehouseId;
const before = cliData("searchIndexReadiness").find(
  (row) => row.warehouseId === warehouseId && row.kind === "jobScans",
);
if (!before?.ready)
  throw Error("Search backfill must be ready before this probe");
const buildingsBefore = cliData("storageBuildings").filter(
  (row) => row.warehouseId === warehouseId,
).length;
const suffix = Date.now();
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
const created = await client.mutation(
  "storageLayouts/writes:createStorageBuilding",
  {
    warehouseId,
    requestId: `perf-building-${suffix}`,
    code: `PERF-${suffix}`,
    name: `Performance reconciliation ${suffix}`,
    widthMm: 10000,
    depthMm: 10000,
    defaultFloorHeightMm: 3000,
    floorCount: 1,
  },
);
if (!created.ok || !created.value?.written)
  throw Error(`Create refused: ${JSON.stringify(created)}`);
const logs = startLogCollector(deployment);
let report;
try {
  client.setAdminAuth(deployment.adminKey);
  const started = Date.now();
  const t0 = performance.now();
  const result = await client.function(
    "finishedGoods/searchIndexBackfill:reconcile",
    undefined,
    { warehouseId, kind: "jobScans" },
  );
  const rttMs = performance.now() - t0;
  await logs.settle(Date.now());
  const executions = logs.entries.filter(
    (entry) =>
      entry.identifier === "finishedGoods/searchIndexBackfill:reconcile" &&
      entry.caller === "HttpApi" &&
      entry.executionTimestamp * 1000 >= started,
  );
  if (executions.length !== 1)
    throw Error(`Expected one completion, found ${executions.length}`);
  report = {
    label,
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    buildingsBefore,
    addedBuildings: 1,
    result,
    rttMs,
    executions: executions.map(({ usageStats, executionTime, error }) => ({
      usageStats,
      executionTime,
      error,
    })),
    scope:
      "Real local engine; one observation; leaves one new draft building; excludes create cost and scheduled follow-up work",
  };
} finally {
  await logs.stop();
}
writeFileSync(
  `output/perf/${label}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
