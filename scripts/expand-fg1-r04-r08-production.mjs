// FG1 r2 -> r3 only. Run with Node 24 and a private CONVEX_ADMIN_KEY --env-file.
// Preflight is read-only; the guarded mutation is called once, never retried.
// Local controls: scripts/lib/productionOperator.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  fg1ApprovedPlan,
  fg1RearPlan,
  FG1_REAR_REVISION,
  FG1_REVISION,
} from "../convex/model/storageLayout/fg1ApprovedPlan.ts";
import {
  PRODUCTION_OPERATOR_TARGET,
  prepareOperatorRun,
} from "./lib/productionOperator.mjs";

let run;
try {
  run = prepareOperatorRun({ backupModes: ["apply", "verify"] });
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? `Refused: ${error.message.split("\n")[0]}`
      : "Refused: operator controls could not be verified.",
  );
  process.exit(1);
}
const values = { mode: run.mode };
const target = {
  warehouseId: "p17ckfaqgw6dprz8d3tfv1tkhd8ez4e6",
  buildingId: "n57effrz60rbq7fqx438q6r6fx8f0hed",
};
const url = PRODUCTION_OPERATOR_TARGET.deploymentUrl;
assert.equal(run.url, url, "Wrong deployment");
const directory = run.directory;
const client = new ConvexHttpClient(url, { logger: false });
client.setAdminAuth(run.adminKey, {
  subject: "user_3Je6gsq8cJfoVOXcjjHGs8qvDGs",
  issuer: "https://clerk.thaipropertyai.com",
  org_id: "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ",
  o: { id: "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ" },
});
async function call(kind, path, args) {
  const result = await client[kind](makeFunctionReference(path), args);
  assert.equal(result.ok, true, "Application denied request");
  return result.value;
}
async function save(name, data) {
  const path = resolve(directory, name);
  const contents = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(path, contents, { flag: "wx", mode: 0o600 });
  return { path, sha256: createHash("sha256").update(contents).digest("hex") };
}
async function others() {
  const buildings = await call(
    "query",
    "storageLayouts/catalogue:listStorageBuildings",
    {
      warehouseId: target.warehouseId,
    },
  );
  assert.equal(
    buildings.filter((building) => building.code === "FG1").length,
    1,
  );
  return Promise.all(
    buildings
      .filter((building) => building.buildingId !== target.buildingId)
      .map((building) =>
        call("query", "storageLayouts/catalogue:getStorageBuilding", {
          warehouseId: target.warehouseId,
          buildingId: building.buildingId,
        }),
      ),
  );
}
async function preflight() {
  const result = await call(
    "query",
    "storageLayouts/fg1Import:preflight",
    target,
  );
  assert.equal(result.revision, FG1_REVISION, "Updated backend not deployed");
  assert.equal(result.backup.building._id, target.buildingId);
  assert.equal(result.backup.warehouse._id, target.warehouseId);
  assert.equal(result.backup.warehouse.code, "TG-OPT");
  assert.deepEqual(
    result.plan,
    fg1ApprovedPlan(),
    "Backend plan differs from checkout",
  );
  return result;
}
const geometry = (row) => [row.xMm, row.yMm, row.widthMm, row.depthMm];
const shape = (row) =>
  JSON.stringify([
    row.label,
    row.areaKind,
    row.color,
    row.displayHeightMm,
    ...geometry(row),
  ]);
function assertBefore(current, backup) {
  assert.equal(backup.deployment, url);
  assert.equal(backup.revision, FG1_REVISION);
  assert.equal(backup.backup.building._id, target.buildingId);
  assert.equal(backup.backup.warehouse._id, target.warehouseId);
  assert.equal(backup.backup.building.fg1Import?.revision, FG1_REAR_REVISION);
  assert.equal(backup.blocked, false, "Snapshot was blocked by live activity");
  assert.equal(
    current.blocked,
    false,
    "Stock, reservation, or move blocks change",
  );
  assert.equal(
    current.digest,
    backup.digest,
    "Production changed since backup",
  );
  const old = fg1RearPlan();
  assert.deepEqual(
    backup.backup.blocks.map(shape).sort(),
    old.blocks.map(shape).sort(),
  );
  for (const cell of old.cells) {
    const zone = backup.backup.zones.find((row) => row.code === cell.code);
    const position = backup.backup.positions.find(
      (row) => row.zoneId === zone?._id,
    );
    assert.ok(zone && position, `Missing ${cell.code}`);
    assert.deepEqual(geometry(zone), geometry(cell));
    assert.deepEqual(geometry(position), geometry(cell));
  }
}
async function verify(before, after) {
  const plan = fg1ApprovedPlan();
  assert.equal(after.backup.building.fg1Import?.revision, FG1_REVISION);
  assert.equal(
    after.backup.building.version,
    before.backup.building.version + 1,
  );
  assert.equal(after.backup.floors[0]._id, before.backup.floors[0]._id);
  assert.equal(
    after.backup.floors[0].version,
    before.backup.floors[0].version + 1,
  );
  for (const field of [
    "widthMm",
    "depthMm",
    "grossAreaSqMm",
    "reservedAreaSqMm",
    "usableAreaSqMm",
  ])
    assert.equal(after.backup.building[field], plan[field], field);
  assert.equal(after.backup.building.status, before.backup.building.status);
  assert.equal(
    after.backup.building.defaultFloorHeightMm,
    before.backup.building.defaultFloorHeightMm,
  );
  assert.deepEqual(
    after.backup.blocks.map(shape).sort(),
    plan.blocks.map(shape).sort(),
  );
  assert.equal(after.backup.blocks.length, 14);
  for (const block of after.backup.blocks)
    assert.ok(
      before.backup.blocks.some((old) => old._id === block._id),
      "Unexpected reserved block ID",
    );
  for (const cell of plan.cells) {
    const zone = after.backup.zones.find((row) => row.code === cell.code);
    const position = after.backup.positions.find(
      (row) => row.zoneId === zone?._id,
    );
    assert.ok(zone && position, `Missing ${cell.code}`);
    assert.deepEqual(geometry(zone), geometry(cell));
    assert.deepEqual(geometry(position), geometry(cell));
    const oldZone = before.backup.zones.find((row) => row.code === cell.code);
    const oldPosition = before.backup.positions.find(
      (row) => row.zoneId === oldZone?._id,
    );
    assert.equal(zone._id, oldZone._id);
    assert.equal(zone.qrValue, oldZone.qrValue);
    assert.equal(position._id, oldPosition._id);
    assert.equal(position.qrValue, oldPosition.qrValue);
  }
  for (const table of [
    "locations",
    "placements",
    "moves",
    "assignments",
    "pallets",
    "legacyZones",
    "legacyPositions",
    "legacyLocations",
    "jobScans",
  ])
    assert.deepEqual(
      after.backup[table],
      before.backup[table],
      `${table} changed`,
    );
  assert.deepEqual(
    await others(),
    before.otherBuildings,
    "Another building changed",
  );
}
async function main() {
  if (values.mode === "preflight") {
    const current = await preflight();
    assert.equal(
      current.backup.building.fg1Import?.revision,
      FG1_REAR_REVISION,
    );
    assert.equal(current.blocked, false);
    const backup = {
      ...current,
      deployment: url,
      capturedAt: new Date().toISOString(),
      otherBuildings: await others(),
    };
    assertBefore(current, backup);
    const artifact = await save("fg1-r3-before.json", backup);
    console.log(
      JSON.stringify({ ready: true, digest: current.digest, artifact }),
    );
    return;
  }
  // Private 0600 file whose SHA-256 matched --backup-sha256 before any request.
  const backup = run.backup.data;
  if (values.mode === "apply") {
    const current = await preflight();
    assertBefore(current, backup);
    assert.deepEqual(
      await others(),
      backup.otherBuildings,
      "Another building changed since backup",
    );
    await save("fg1-r3-apply-intent.json", {
      target,
      revision: FG1_REVISION,
      expectedDigest: backup.digest,
      startedAt: new Date().toISOString(),
    });
    const result = await call(
      "mutation",
      "storageLayouts/fg1Import:expandRearCells",
      {
        ...target,
        revision: FG1_REVISION,
        expectedDigest: backup.digest,
      },
    );
    console.log(
      JSON.stringify({
        mutation: await save("fg1-r3-apply-result.json", result),
      }),
    );
  }
  const after = await preflight();
  const artifact = await save(
    values.mode === "verify"
      ? `fg1-r3-verify-${Date.now()}.json`
      : "fg1-r3-after.json",
    after,
  );
  await verify(backup, after);
  console.log(
    JSON.stringify({
      verified: true,
      revision: FG1_REVISION,
      zones: after.backup.zones.length,
      blocks: after.backup.blocks.length,
      usableAreaSqM: after.backup.building.usableAreaSqMm / 1e6,
      artifact,
    }),
  );
}
main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message.split("\n")[0]
      : "Operation failed or outcome uncertain; inspect private artifacts and production revision. No automatic retry.",
  );
  process.exitCode = 1;
});
