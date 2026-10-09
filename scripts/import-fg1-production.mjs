// Run with Node 24 and --env-file pointing to the private CONVEX_ADMIN_KEY file.
// Default is read-only. No automatic retry of any mutation. Local controls:
// scripts/lib/productionOperator.mjs; procedure: docs/operations/release-runbook.md.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  FG1_REVISION,
  fg1ApprovedPlan,
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
  assert.equal(result.ok, true, "Application denied the request");
  return result.value;
}
async function save(name, value) {
  const path = resolve(directory, name);
  const text = JSON.stringify(value, null, 2) + "\n";
  await writeFile(path, text, { flag: "wx", mode: 0o600 });
  return { path, sha256: createHash("sha256").update(text).digest("hex") };
}
async function others() {
  const buildings = await call(
    "query",
    "storageLayouts/catalogue:listStorageBuildings",
    { warehouseId: target.warehouseId },
  );
  assert.equal(buildings.filter((b) => b.code === "FG1").length, 1);
  return Promise.all(
    buildings
      .filter((b) => b.buildingId !== target.buildingId)
      .map((b) =>
        call("query", "storageLayouts/catalogue:getStorageBuilding", {
          warehouseId: target.warehouseId,
          buildingId: b.buildingId,
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
  assert.equal(result.revision, FG1_REVISION);
  assert.equal(result.backup.building._id, target.buildingId);
  assert.equal(result.backup.warehouse.code, "TG-OPT");
  assert.deepEqual(
    result.plan,
    fg1ApprovedPlan(),
    "Deployed geometry differs from reviewed checkout",
  );
  return result;
}
async function main() {
  if (values.mode === "preflight") {
    const current = await preflight();
    const artifact = await save("preflight.json", {
      ...current,
      otherBuildings: await others(),
      capturedAt: new Date().toISOString(),
      deployment: url,
    });
    console.log(
      JSON.stringify({
        ...artifact,
        blocked: current.blocked,
        revision: current.revision,
        digest: current.digest,
        locations: current.backup.locations.length,
      }),
    );
    if (current.blocked) process.exitCode = 2;
    return;
  }
  // Private 0600 file whose SHA-256 matched --backup-sha256 before any request.
  const original = run.backup.data;
  assert.equal(original.deployment, url);
  assert.equal(original.revision, FG1_REVISION);
  if (values.mode === "apply") {
    const fresh = await preflight();
    assert.equal(fresh.blocked, false, "Stock/reservation/move blocks import");
    assert.equal(
      fresh.digest,
      original.digest,
      "Preflight changed; inspect and back up again",
    );
    assert.deepEqual(
      await others(),
      original.otherBuildings,
      "Other buildings changed; inspect first",
    );
    // Establish a durable intent before sending: an interrupted run must not be retried blindly.
    await save("apply-intent.json", {
      target,
      revision: FG1_REVISION,
      expectedDigest: original.digest,
      startedAt: new Date().toISOString(),
    });
    const result = await call("mutation", "storageLayouts/fg1Import:apply", {
      ...target,
      revision: FG1_REVISION,
      expectedDigest: original.digest,
    });
    console.log(JSON.stringify(await save("apply-result.json", result)));
  }
  const after = await preflight();
  const artifact = await save(
    values.mode === "verify" ? `verify-${Date.now()}.json` : "after.json",
    after,
  );
  assert.equal(after.backup.building.fg1Import?.revision, FG1_REVISION);
  assert.equal(after.backup.building.widthMm, 12260);
  assert.equal(after.backup.building.depthMm, 29930);
  const approved = fg1ApprovedPlan();
  assert.equal(after.backup.building.usableAreaSqMm, approved.usableAreaSqMm);
  assert.equal(
    after.backup.building.reservedAreaSqMm,
    approved.reservedAreaSqMm,
  );
  assert.equal(after.backup.floors[0]._id, original.backup.floors[0]._id);
  const fields = (r) => [r.xMm, r.yMm, r.widthMm, r.depthMm];
  for (const cell of approved.cells) {
    const actual = after.backup.zones.find((z) => z.code === cell.code);
    assert.ok(actual, "Approved cell missing after import");
    assert.deepEqual(
      fields(actual),
      fields(cell),
      "Approved geometry mismatch",
    );
  }
  const blockValues = (b) =>
    JSON.stringify([
      b.label,
      b.areaKind,
      b.color,
      b.displayHeightMm,
      ...fields(b),
    ]);
  assert.deepEqual(
    after.backup.blocks.map(blockValues).sort(),
    approved.blocks.map(blockValues).sort(),
  );
  for (const block of original.backup.blocks)
    assert.ok(
      after.backup.blocks.some((b) => b._id === block._id),
      "Reserved block identity lost",
    );
  assert.equal(after.backup.building.status, original.backup.building.status);
  assert.equal(
    after.backup.building.defaultFloorHeightMm,
    original.backup.building.defaultFloorHeightMm,
  );
  for (const table of ["zones", "positions"]) {
    const ids = (rows) =>
      rows.map((r) => [r._id, r.code, r.qrValue, r.locationId]);
    assert.deepEqual(
      ids(after.backup[table]),
      ids(original.backup[table]),
      `${table} identity changed`,
    );
  }
  assert.deepEqual(after.backup.locations, original.backup.locations);
  for (const zone of after.backup.zones) {
    const position = after.backup.positions.find((p) => p.zoneId === zone._id);
    assert.ok(position);
    for (const field of ["xMm", "yMm", "widthMm", "depthMm"])
      assert.equal(
        position[field],
        zone[field],
        "Default-position geometry differs from its zone",
      );
  }
  for (const table of [
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
      original.backup[table],
      `${table} changed`,
    );
  assert.deepEqual(
    await others(),
    original.otherBuildings,
    "Other buildings changed",
  );
  console.log(
    JSON.stringify({
      verified: true,
      revision: FG1_REVISION,
      locations: 15,
      dimensionsMm: [12260, 29930],
      usableAreaSqM: after.backup.building.usableAreaSqMm / 1e6,
      ...artifact,
    }),
  );
}
main().catch((error) => {
  // Never print SDK error bodies or credentials. Check artifacts and query revision before any retry.
  console.error(
    error instanceof assert.AssertionError
      ? error.message.split("\n")[0]
      : "Operation failed or outcome uncertain; inspect private artifacts and production revision. No automatic retry.",
  );
  process.exitCode = 1;
});
